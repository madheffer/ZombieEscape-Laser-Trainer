// A Source 1 map's env_cubemaps -> cubemaps/cubemaps.png + cubemaps.json, what a material's $envmap reflects.
// LUMP_CUBEMAPS (42): dcubemapsample_t { int origin[3]; int size } per env_cubemap; the pictures vbsp / buildcubemaps
// packed: materials/maps/<map>/c<x>_<y>_<z>.hdr.vtf (RGBA16161616, integer HDR), else the LDR .vtf. A VTF cube's faces
// are uploaded in order to D3D's +X -X +Y -Y +Z -Z and sampled with the world-space reflection vector (Source axes),
// so face i here is that axis. The atlas: a row per cubemap, its 6 faces side by side at Face px, RGBM (rgb x a x
// Range, linear). An HDR texel is its 16-bit value / 65535 (the texture's UNORM read) x ENV_MAP_SCALE (common_ps_fxc.h:
// cLightScale.z, pixel shader constant c30), which CS:GO's shaderapidx9.dll sets to 16 under integer HDR and 1 under
// float HDR (FUN_10029c00, SetToneMappingScaleLinear: c30 = { tonemap scale, lightmap scale, 16 | 1, tonemap scale }
// by HardwareConfig()->GetHDRType()); its caps set m_HDRType (caps + 0x2b8) to HDR_TYPE_INTEGER unconditionally
// (FUN_1002e460 ComputeCapsFromD3D, FUN_10005780 the dxlevel defaults) and nothing sets HDR_TYPE_FLOAT: x 16.
// Cubemap mips (the rougher reflections) aren't kept.
// Which cubemap: a brush's compiled VMT names its own ($envmap maps/<map>/c<x>_<y>_<z>, IndexOf); "env_cubemap" on a
// model takes the one nearest the model (Nearest; the engine's per-model pick by its lighting origin).
using System.Numerics;
using System.Text.Json.Nodes;

namespace Lasers.Bake.Source1;

sealed class CubemapBake
{
    public const int Face = 32, Range = 16, MaxRows = 255;
    readonly List<Vector3> origins = [];

    public int Count => origins.Count;

    public static CubemapBake Bake(Bsp bsp, GameFiles files, string mapName, string outDir, Action<string> log)
    {
        var cb = new CubemapBake();
        var (o, len) = bsp.Lumps[42];
        var faces = new List<float[][]>();
        for (var i = 0; i < len / 16 && cb.origins.Count < MaxRows; i++)
        {
            int x = Bsp.I(bsp.Data, o + i * 16), y = Bsp.I(bsp.Data, o + i * 16 + 4), z = Bsp.I(bsp.Data, o + i * 16 + 8);
            var name = $"materials/maps/{mapName}/c{x}_{y}_{z}";
            var f = (files.Read(name + ".hdr.vtf") is { } hdr ? Vtf.DecodeCube(hdr) : null) ?? (files.Read(name + ".vtf") is { } ldr ? Vtf.DecodeCube(ldr) : null);
            if (f == null) continue;
            cb.origins.Add(new Vector3(x, y, z));
            faces.Add(f);
        }
        if (cb.Count == 0) return cb;
        var w = Face * 6;
        var rgba = new byte[w * Face * cb.Count * 4];
        for (var r = 0; r < cb.Count; r++)
            for (var fi = 0; fi < 6; fi++)
                for (var py = 0; py < Face; py++)
                    for (var pxl = 0; pxl < Face; pxl++)
                    {
                        var src = faces[r][fi];
                        var s = (py * Face + pxl) * 3;
                        float cr = src[s], cg = src[s + 1], cbl = src[s + 2];
                        var m = Math.Clamp(MathF.Max(cr, MathF.Max(cg, cbl)) / Range, 1f / 255, 1);
                        m = MathF.Ceiling(m * 255) / 255;
                        var d = (((r * Face + py) * w) + fi * Face + pxl) * 4;
                        rgba[d] = (byte)Math.Clamp(MathF.Round(cr / (m * Range) * 255), 0, 255);
                        rgba[d + 1] = (byte)Math.Clamp(MathF.Round(cg / (m * Range) * 255), 0, 255);
                        rgba[d + 2] = (byte)Math.Clamp(MathF.Round(cbl / (m * Range) * 255), 0, 255);
                        rgba[d + 3] = (byte)(m * 255);
                    }
        var dir = Path.Combine(outDir, "cubemaps");
        Directory.CreateDirectory(dir);
        File.WriteAllBytes(Path.Combine(dir, "cubemaps.png"), Materials.EncodePng(new Vtf.Image(w, Face * cb.Count, rgba, true), int.MaxValue));
        var list = new JsonArray();
        foreach (var p in cb.origins) list.Add(new JsonArray(p.X, p.Y, p.Z));
        File.WriteAllText(Path.Combine(dir, "cubemaps.json"), new JsonObject { ["file"] = "cubemaps.png", ["face"] = Face, ["range"] = Range, ["list"] = list }.ToJsonString());
        log($"cubemaps: {cb.Count} of {len / 16}");
        return cb;
    }

    // the cubemap nearest p, -1 without any
    public int Nearest(Vector3 p)
    {
        var best = -1;
        var bd = float.MaxValue;
        for (var i = 0; i < origins.Count; i++)
        {
            var d = Vector3.DistanceSquared(origins[i], p);
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }

    // a compiled $envmap "maps/<map>/c<x>_<y>_<z>" -> its cubemap, -1 when it names none of them
    public int IndexOf(string envmap)
    {
        var m = System.Text.RegularExpressions.Regex.Match(envmap.Replace('\\', '/'), @"/c(-?\d+)_(-?\d+)_(-?\d+)(\.hdr)?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!m.Success) return -1;
        var p = new Vector3(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value));
        return origins.FindIndex(o => o == p);
    }
}
