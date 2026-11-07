// Source 1 materials -> glTF materials + PNGs: the VMT's $basetexture (WorldVertexTransition: its first layer),
// alpha from $translucent / $additive (blend) and $alphatest (mask at $alphatestreference), $nocull, $color / $alpha;
// a model's $color2 and its self-illumination ($selfillum, $selfillumtint, an additive self-illum detail: Glow).
// Each texture is decoded once and written (capped at Baker.MaxTexture px) into whichever folder a glb needs it in.
using System.Globalization;
using System.Numerics;
using SkiaSharp;

namespace Lasers.Bake.Source1;

sealed class Materials(GameFiles files, Action<string> log)
{
    public sealed record Info(string Name, string? Texture, string AlphaMode, float Cutoff, bool DoubleSided, Vector4 Color, int Width, int Height, bool Tool, bool Additive, bool Unlit = false, RefractInfo? Refract = null, float? BlendCutoff = null, Glow? Glow = null, bool NoCull = false, Proxies? Proxies = null);

    // A VMT's material proxies (the Proxies block: name + its key values, in order) with the material vars they read
    // or write as the VMT sets them (strings: the renderer parses vectors / matrices), run each frame by
    // world/source1-proxies.js (SDK 2013 game/client/mathproxy.cpp, texturescrollmaterialproxy.cpp). Writes: the vars
    // a proxy sets; a static $color / $color2 / $alpha a proxy drives is left out of the baked colour.
    public sealed record Proxies(List<(string Name, Dictionary<string, string> Kv)> List, Dictionary<string, string> Vars, HashSet<string> Writes);

    // What a VertexLitGeneric model draws beyond albedo x light, read from Source SDK 2013's stdshaders (CS:GO's
    // VertexLitGeneric is that code's descendant: vertexlitgeneric_dx9_helper.cpp, skin_dx9_helper.cpp + skin_ps20b.fxc,
    // vertexlit_and_unlit_generic_ps2x.fxc, emissive_scroll_blended_pass_*):
    //   SelfIllum: $selfillum lerps the lit colour to $selfillumtint x albedo (albedo already x $color x $color2 x
    //     rendercolor) by the base alpha, or by $selfillummask's rgb (SelfIllumMask). The helpers drop $selfillum when
    //     the base VTF has no alpha flag and there is no mask. With $selfillum on, the base alpha is only the mask:
    //     the surface's alpha is the modulation alpha alone.
    //   Detail ($detailblendmode 5): the $detail texture x $detailtint x $detailblendfactor added after the lighting.
    //   Skin: $phong with a $bumpmap (or $basemapalphaphongmask 1, or a $lightwarptexture) draws with the skin shader,
    //     which adds the detail after the self-illum lerp; plain VertexLitGeneric adds it before.
    //   RimBoost: the skin shader's $rimlight: ambient cube along the eye x $rimlightboost x saturate(Fresnel4 x N.z),
    //     x $phongtint (white when unset).
    //   Emissive: the $emissiveBlendEnabled pass, added on top (ONE, ONE): $emissiveBlendBaseTexture x
    //     $emissiveBlendTexture at ($emissiveBlendFlowTexture.xy + $emissiveBlendScrollVector x t) x $emissiveBlendTint
    //     x $emissiveBlendStrength (clamped 0..1; unset 0: no pass).
    // ze_lifeforms_v1_1's protozoa and gonarch-bomb balls are self-lit in near-black ambient light: drawn lit only,
    // they came out black. UNSETTLED: specular from local lights (they are folded into the ambient cube here,
    // AmbientLight.cs) and $envmap; the bump map's normal under the rim light (the vertex normal is used);
    // $selfillumfresnel; CS:GO-only keys ($srgbtint) not in the SDK.
    //   Bump: the $bumpmap (DirectX-style, X+ Y- as Source's tools write it), lighting each pixel by the ambient cube along
    //     the bumped normal (vertexlit_and_unlit_generic_bump_ps2x / skin_ps20b PixelShaderDoLighting); its alpha is the
    //     phong / envmap mask ($normalmapalphaenvmapmask).
    //   SelfIllumFresnel: $selfillumfresnel's scale, bias, exponent, brightness from $selfillumfresnelminmaxexp
    //     (skin_dx9_helper.cpp: bias min / max, scale 1 - bias, brightness max): the self-illum lerp's mask x
    //     saturate(pow(saturate(N.V), exp) x scale + bias), toward tint x albedo x brightness.
    public sealed record Glow(Vector3? SelfIllum, string? SelfIllumMask, string? Detail, float DetailScale, float DetailFactor,
        Vector3 DetailTint, bool Skin, float? RimBoost, Vector3 PhongTint, Emissive? Emissive, string? Bump = null,
        Vector4? SelfIllumFresnel = null, Phong? Phong = null, bool HalfLambert = false, Env? Env = null);

    // $envmap (CubemapBake.cs): Cube the compiled VMT's own cubemap (a brush's), -1 for "env_cubemap" (a model takes the
    // one nearest it, the entity's _s1cube); Tint $envmaptint, Contrast $envmapcontrast (0), Saturation
    // $envmapsaturation (1), Fresnel the skin shader's $envmapfresnel (0), LmFresnel LightmappedGeneric's
    // $fresnelreflection (1); Mask: 1 $envmapmask's rgb (MaskTex), 2 1 - base alpha ($basealphaenvmapmask), 3 the bump's
    // alpha ($normalmapalphaenvmapmask), 0 none (the skin shader's own rule picks base alpha or the phong mask).
    // lightmappedgeneric_ps2x / vertexlit_and_unlit_generic(_bump)_ps2x: envmap x mask x tint, lerp(x, x^2, contrast),
    // lerp(grey, x, saturation); LightmappedGeneric x lerp(fresnelreflection, 1, (1 - N.V)^5); skin_ps20b: x mask x
    // lerp(1, Fresnel ranges, $envmapfresnel), no contrast / saturation.
    public sealed record Env(int Cube, Vector3 Tint, float Contrast, float Saturation, float Fresnel, float LmFresnel, int Mask, string? MaskTex);
    public Func<string, int>? CubeIndex;

    // The skin shader's specular from local lights (skin_ps20b.fxc, skin_dx9_helper.cpp): Exponent ($phongexponent;
    // -1 = from the exponent texture's red, 1 + 149 r), ExponentTexture ($phongexponenttexture: r exponent, g albedo
    // tint mask, a rim mask), Boost ($phongboost, 1), Fresnel ($phongfresnelranges encoded as the helper does:
    // ((mid - min) x 2, mid, (max - mid) x 2); unset: the raw (1, 0.5, 1)), BaseAlphaMask ($basemapalphaphongmask),
    // AlbedoTint ($phongalbedotint with an exponent texture: the tint lerps to the base colour by its green),
    // RimExponent ($rimlightexponent, 4, at least 1), RimMask ($rimmask with an exponent texture: its alpha),
    // LightWarp ($lightwarptexture: the diffuse term looked up as 2 x warp(halflambert)); TintSet: $phongtint was given.
    public sealed record Phong(float Exponent, string? ExponentTexture, float Boost, Vector3 Fresnel, bool BaseAlphaMask,
        bool AlbedoTint, float RimExponent, bool RimMask, string? LightWarp, bool TintSet);

    public sealed record Emissive(string Base, string Texture, string? Flow, Vector2 Scroll, Vector3 Tint, float Strength);

    // A Refract material (Source's refract shader: the scene behind it warped by a normal map): its $normalmap's PNG,
    // $refractamount, $bluramount, $refracttint and its TextureScroll proxy on $bumptransform (rate in texture units a
    // second, angle in degrees). UNSETTLED: the defaults for a key the VMT leaves out (refract.cpp not read): amount 0.5,
    // blur 1, tint white. $refracttinttexture multiplies the tint (refract_ps2x REFRACTTINTTEXTURE): its PNG goes in
    // the base colour slot.
    public sealed record RefractInfo(string? Normal, float Amount, float Blur, Vector3 Tint, float ScrollRate, float ScrollAngle, string? TintTexture = null);

    readonly Dictionary<string, Info> cache = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, byte[]?> png = new(StringComparer.OrdinalIgnoreCase);
    readonly HashSet<string> translucentTex = new(StringComparer.OrdinalIgnoreCase); // VTFs with an alpha flag
    public readonly SortedSet<string> Missing = new(StringComparer.OrdinalIgnoreCase);

    public Info Get(string material)
    {
        var key = GameFiles.Norm(material);
        if (cache.TryGetValue(key, out var hit)) return hit;
        var vmt = Vmt.Load(files, key);
        if (vmt == null) Missing.Add($"materials/{key}.vmt");
        var tex = vmt?.Get("$basetexture")?.Replace('\\', '/').Trim();
        int w = 0, h = 0;
        string? file = null;
        if (!string.IsNullOrEmpty(tex))
        {
            var bytes = Png(tex, out w, out h);
            if (bytes != null) file = FileName(tex);
            else Missing.Add($"materials/{GameFiles.Norm(tex)}.vtf");
        }
        // additive: $additive, or a Sprite material drawn in an additive sprite render mode (glow 3, add 5,
        // add-frameblend 7, alpha-add 8, world glow 9: Source's kRender* values). ze_ffvii_malgo_reactor's lasers are
        // brushes textured with sprites/bluelaser1 ($spriterendermode 5)
        var spriteMode = (int)(vmt?.Num("$spriterendermode", 0) ?? 0);
        var additive = vmt != null && (vmt.Flag("$additive") || (vmt.Shader == "sprite" && spriteMode is 3 or 5 or 7 or 8 or 9));
        var translucent = vmt != null && (vmt.Flag("$translucent") || additive);
        var alphaTest = vmt != null && vmt.Flag("$alphatest");
        var proxies = vmt != null ? ProxiesOf(vmt) : null;
        bool Driven(string v) => proxies?.Writes.Contains(v) == true;
        var color = Vector3.One;
        if (!Driven("$color") && !Driven("$color2") && vmt?.Get("$color") is { } c) color = Color(c);
        // $color2: a model's colour modulation (VertexLitGeneric multiplies it with $color)
        if (!Driven("$color") && !Driven("$color2") && vmt?.Shader == "vertexlitgeneric" && vmt.Get("$color2") is { } c2) color *= Color(c2);
        var alpha = vmt?.Num("$alpha", 1) ?? 1;
        if (Driven("$alpha")) { alpha = 1; translucent = true; } // the proxy's $alpha multiplies it in (blended)
        var shader = vmt?.Shader ?? "";
        if (file == null && shader.Contains("water")) { color = new Vector3(0.2f, 0.3f, 0.35f); alpha = 0.6f; translucent = true; }
        var refract = shader == "refract" && vmt != null ? Refraction(vmt) : null;
        if (refract != null) { translucent = true; w = h = 0; file = refract.TintTexture; } // its UVs: the BSP's texdata size (the %tooltexture's)
        var info = new Info(key, file, translucent || alpha < 1 ? "BLEND" : alphaTest ? "MASK" : "OPAQUE",
            vmt?.Num("$alphatestreference", 0.5f) ?? 0.5f, vmt?.Flag("$nocull") == true || translucent,
            new Vector4(color, alpha), w, h, key.StartsWith("tools/") && key != "tools/toolsblack", additive, shader == "unlitgeneric" || refract != null, refract,
            // $translucent with $alphatest: Source enables both the blend and the alpha test (aztec_grass_field, ref .5)
            translucent && alphaTest && !additive ? vmt?.Num("$alphatestreference", 0.5f) ?? 0.5f : null,
            vmt != null && refract == null && shader != "unlitgeneric" ? GlowOf(vmt, tex) : null,
            // a studio model culls back faces unless $nocull ($translucent doesn't change the cull mode): PropBake
            vmt?.Flag("$nocull") == true, proxies);
        cache[key] = info;
        return info;
    }

    static readonly string[] ResultKeys = ["resultvar", "texturescrollvar", "animatedtextureframenumvar"];

    static Proxies? ProxiesOf(Vmt vmt)
    {
        if (vmt.ProxyList.Count == 0) return null;
        var list = new List<(string, Dictionary<string, string>)>();
        var vars = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var writes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static string Base(string v) => (v.IndexOf('[') is var b and > 0 ? v[..b] : v).Trim().ToLowerInvariant();
        foreach (var (name, kv) in vmt.ProxyList)
        {
            var lower = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (k, v) in kv)
            {
                lower[k.ToLowerInvariant()] = v;
                var val = v.Trim();
                if (!val.StartsWith('$')) continue;
                var vn = Base(val);
                if (vmt.Get(vn) is { } set) vars[vn] = set;
                if (ResultKeys.Contains(k.ToLowerInvariant())) writes.Add(vn);
            }
            list.Add((name, lower));
        }
        return new Proxies(list, vars, writes);
    }

    Glow? GlowOf(Vmt vmt, string? baseTex)
    {
        var vlg = vmt.Shader == "vertexlitgeneric";
        var mask = vmt.Flag("$selfillum") ? Image(vmt.Get("$selfillummask")) : null;
        // no alpha flag on the base VTF and no mask: the helpers clear $selfillum (VertexLitGeneric; others as authored)
        var selfOn = vmt.Flag("$selfillum") && (!vlg || mask != null || (baseTex != null && translucentTex.Contains(GameFiles.Norm(baseTex))));
        Vector3? self = selfOn ? (vmt.Get("$selfillumtint") is { } t ? Color(t) : Vector3.One) : null;
        var detail = (int)vmt.Num("$detailblendmode", 0) == 5 ? Image(vmt.Get("$detail")) : null;
        var skin = vlg && vmt.Flag("$phong") && (Image(vmt.Get("$bumpmap")) != null || vmt.Flag("$basemapalphaphongmask") || Image(vmt.Get("$lightwarptexture")) != null);
        float? rim = skin && vmt.Flag("$rimlight") ? Math.Max(0, vmt.Num("$rimlightboost", 1)) : null;
        Emissive? emissive = null;
        if (vlg && vmt.Flag("$emissiveblendenabled") && Math.Clamp(vmt.Num("$emissiveblendstrength", 0), 0, 1) is var strength && strength > 0
            && Image(vmt.Get("$emissiveblendbasetexture")) is { } eb && Image(vmt.Get("$emissiveblendtexture")) is { } et)
        {
            var sv = vmt.Get("$emissiveblendscrollvector")?.Trim().Trim('[', ']').Split(' ', StringSplitOptions.RemoveEmptyEntries);
            float Sv(int i, float d) => sv != null && i < sv.Length && float.TryParse(sv[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? f : d;
            emissive = new Emissive(eb, et, Image(vmt.Get("$emissiveblendflowtexture")), new Vector2(Sv(0, 0.11f), Sv(1, 0.124f)),
                vmt.Get("$emissiveblendtint") is { } et2 ? Color(et2) : Vector3.One, strength);
        }
        var bump = vlg ? Image(vmt.Get("$bumpmap")) : null;
        Vector4? fresnel = null;
        if (self != null && vmt.Flag("$selfillumfresnel"))
        {
            var mm = vmt.Get("$selfillumfresnelminmaxexp")?.Trim().Trim('[', ']').Split(' ', StringSplitOptions.RemoveEmptyEntries);
            float Mm(int i, float d) => mm != null && i < mm.Length && float.TryParse(mm[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? f : d;
            float mn = Mm(0, 0), mx = Mm(1, 1), ex = Mm(2, 1), bias = mx != 0 ? mn / mx : 0;
            fresnel = new Vector4(1 - bias, bias, ex, mx);
        }
        Phong? phong = null;
        if (skin)
        {
            var expTex = Image(vmt.Get("$phongexponenttexture"));
            var fr = vmt.Get("$phongfresnelranges")?.Trim().Trim('[', ']').Split(' ', StringSplitOptions.RemoveEmptyEntries);
            float Fr(int i, float d) => fr != null && i < fr.Length && float.TryParse(fr[i], NumberStyles.Float, CultureInfo.InvariantCulture, out var f) ? f : d;
            var ranges = fr != null ? new Vector3((Fr(1, 0.5f) - Fr(0, 1)) * 2, Fr(1, 0.5f), (Fr(2, 1) - Fr(1, 0.5f)) * 2) : new Vector3(1, 0.5f, 1);
            var e = vmt.Num("$phongexponent", 0);
            phong = new Phong(e > 0 ? e : -1, expTex, vmt.Get("$phongboost") != null ? vmt.Num("$phongboost", 1) : 1, ranges,
                vmt.Flag("$basemapalphaphongmask"), expTex != null && vmt.Flag("$phongalbedotint"),
                Math.Max(1, vmt.Num("$rimlightexponent", 4)), expTex != null && vmt.Flag("$rimmask"),
                Image(vmt.Get("$lightwarptexture")), vmt.Get("$phongtint") != null);
        }
        var halfLambert = vmt.Flag("$halflambert");
        Env? env = null;
        if (vmt.Get("$envmap")?.Trim() is { Length: > 0 } em && CubeIndex != null)
        {
            var cube = em.Equals("env_cubemap", StringComparison.OrdinalIgnoreCase) ? -1 : CubeIndex(em);
            if (cube >= 0 || em.Equals("env_cubemap", StringComparison.OrdinalIgnoreCase))
            {
                var maskTex = Image(vmt.Get("$envmapmask"));
                var maskMode = maskTex != null ? 1 : vmt.Flag("$basealphaenvmapmask") ? 2 : vmt.Flag("$normalmapalphaenvmapmask") ? 3 : 0;
                env = new Env(cube, vmt.Get("$envmaptint") is { } et3 ? Color(et3) : Vector3.One, vmt.Num("$envmapcontrast", 0),
                    vmt.Num("$envmapsaturation", 1), vmt.Num("$envmapfresnel", 0), vmt.Num("$fresnelreflection", 1), maskMode, maskTex);
            }
        }
        if (self == null && detail == null && rim == null && emissive == null && bump == null && phong == null && env == null) return null;
        var phongTint = vmt.Get("$phongtint") is { } pt ? Color(pt) : Vector3.One;
        if (phongTint == Vector3.Zero) phongTint = Vector3.One; // skin_dx9_helper: a zero tint (and no tint map) is white
        return new Glow(self, mask, detail, vmt.Num("$detailscale", 4), vmt.Num("$detailblendfactor", 1),
            vmt.Get("$detailtint") is { } dt ? Color(dt) : Vector3.One, skin, rim, phongTint, emissive, bump, fresnel, phong, halfLambert, env);
    }

    // a texture key -> its PNG's file name (decoded now), or null (listed missing)
    string? Image(string? tex)
    {
        if (tex?.Replace('\\', '/').Trim() is not { Length: > 0 } t) return null;
        if (Png(t, out _, out _) != null) return FileName(t);
        Missing.Add($"materials/{GameFiles.Norm(t)}.vtf");
        return null;
    }

    RefractInfo Refraction(Vmt vmt)
    {
        var normal = Image(vmt.Get("$normalmap"));
        var tint = vmt.Get("$refracttint") is { } t ? Color(t) : Vector3.One;
        float rate = 0, angle = 0;
        foreach (var (name, kv) in vmt.ProxyList)
        {
            if (name != "texturescroll" || !string.Equals(kv.GetValueOrDefault("texturescrollvar")?.Trim(), "$bumptransform", StringComparison.OrdinalIgnoreCase)) continue;
            float.TryParse(kv.GetValueOrDefault("texturescrollrate"), NumberStyles.Float, CultureInfo.InvariantCulture, out rate);
            float.TryParse(kv.GetValueOrDefault("texturescrollangle"), NumberStyles.Float, CultureInfo.InvariantCulture, out angle);
        }
        return new RefractInfo(normal, vmt.Num("$refractamount", 0.5f), vmt.Num("$bluramount", 1), tint, rate, angle, Image(vmt.Get("$refracttinttexture")));
    }

    // write the material's PNGs into dir (once per dir): its base texture, a Refract's normal map, a Glow's textures
    public void WriteImage(Info m, string dir)
    {
        var e = m.Glow?.Emissive;
        foreach (var f in new[] { m.Texture, m.Refract?.Normal, m.Glow?.Detail, m.Glow?.SelfIllumMask, m.Glow?.Bump, m.Glow?.Phong?.ExponentTexture, m.Glow?.Phong?.LightWarp, m.Glow?.Env?.MaskTex, e?.Base, e?.Texture, e?.Flow })
        {
            if (f == null) continue;
            var path = Path.Combine(dir, f);
            if (File.Exists(path)) continue;
            var bytes = png.GetValueOrDefault(TexKeyOf(f));
            if (bytes != null) File.WriteAllBytes(path, bytes);
        }
    }

    readonly Dictionary<string, string> fileToTex = [];
    string TexKeyOf(string file) => fileToTex.GetValueOrDefault(file, "");

    byte[]? Png(string tex, out int w, out int h)
    {
        w = h = 0;
        var key = GameFiles.Norm(tex);
        var raw = files.Read($"materials/{key}.vtf");
        if (raw == null) return null;
        var img = Vtf.Decode(raw);
        if (img == null) { log($"  texture {key}: unsupported VTF"); return null; }
        w = img.Width; h = img.Height;
        if (img.Translucent) translucentTex.Add(key);
        if (png.TryGetValue(key, out var done)) return done;
        var bytes = EncodePng(img, Baker.MaxTexture);
        png[key] = bytes;
        fileToTex[FileName(tex)] = key;
        return bytes;
    }

    /// A decoded VTF as PNG bytes, its longest side scaled down to max (Mitchell) when larger
    public static byte[] EncodePng(Vtf.Image img, int max)
    {
        var info = new SKImageInfo(img.Width, img.Height, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        using var bmp = new SKBitmap(info);
        System.Runtime.InteropServices.Marshal.Copy(img.Rgba, 0, bmp.GetPixels(), img.Rgba.Length);
        SKBitmap outBmp = bmp;
        if (img.Width > max || img.Height > max)
        {
            var s = (float)max / Math.Max(img.Width, img.Height);
            outBmp = bmp.Resize(new SKImageInfo(Math.Max(1, (int)(img.Width * s)), Math.Max(1, (int)(img.Height * s)), SKColorType.Rgba8888, SKAlphaType.Unpremul),
                new SKSamplingOptions(SKCubicResampler.Mitchell));
        }
        using var image = SKImage.FromBitmap(outBmp);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        var bytes = data.ToArray();
        if (outBmp != bmp) outBmp.Dispose();
        return bytes;
    }

    // a texture path as one safe file name (letters, digits, _): "metal/metalwall01a" -> "metal_metalwall01a.png"
    static string FileName(string tex)
    {
        var s = new string(GameFiles.Norm(tex).Select(ch => char.IsAsciiLetterOrDigit(ch) ? ch : '_').ToArray());
        if (s.Length > 100) s = s[..80] + "_" + Fnv(s).ToString("x8");
        return s + ".png";
    }

    static uint Fnv(string s) { var h = 2166136261u; foreach (var ch in s) h = (h ^ ch) * 16777619u; return h; }

    static Vector3 Color(string s)
    {
        var t = s.Trim().Trim('[', '{', ']', '}').Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var v = new float[3] { 1, 1, 1 };
        for (var i = 0; i < 3 && i < t.Length; i++) float.TryParse(t[i], NumberStyles.Float, CultureInfo.InvariantCulture, out v[i]);
        var braces = s.Contains('{');
        return braces ? new Vector3(v[0], v[1], v[2]) / 255 : new Vector3(v[0], v[1], v[2]);
    }
}
