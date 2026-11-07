// A stock particle material a map names but the game folder we have lacks, rebuilt from its base texture by Valve's own
// naming: HL2 / CS:S ship `particle/<texture>_<variant>.vmt` files that are one SpriteCard over particle/<texture> with
// the variant's keys, and CS:GO's pak01 keeps the textures but only some of those files. Read from the ones both have
// (CS:GO's particle_glow_05_additive / _add_15ob, the map's particle_glow_05_add_15ob and particle_ring_wave_11_add):
//   _add / _additive -> $additive 1     _nofog -> $nofog 1     _addnofog -> both     _<N>ob -> $overbrightfactor N
// and a material with no suffix whose texture exists (particle_glow_05) is the plain translucent SpriteCard.
// UNSETTLED: _minsizebig's $minsize not read (no such file here); left out.
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Lasers.Bake.Source1;

static partial class StockVariants
{
    [GeneratedRegex(@"^(\d+)ob$")]
    private static partial Regex Overbright();

    // "materials/particle/<name>.vmt" (normalised) -> the VMT text, or null when no base texture matches
    public static string? Vmt(string path, Func<string, bool> textureExists)
    {
        const string Dir = "materials/particle/";
        if (!path.StartsWith(Dir) || !path.EndsWith(".vmt")) return null;
        var parts = path[Dir.Length..^4].Split('/');
        var sub = string.Join('/', parts[..^1]);
        var tokens = parts[^1].Split('_').ToList();
        bool additive = false, nofog = false;
        double? overbright = null;
        for (var n = tokens.Count; n >= 1; n--)
        {
            var name = (sub.Length > 0 ? sub + "/" : "") + string.Join('_', tokens.Take(n));
            if (n < tokens.Count && !Suffix(tokens[n], ref additive, ref nofog, ref overbright)) return null;
            if (!textureExists($"{Dir}{name}.vtf")) continue;
            var sb = new StringBuilder("\"SpriteCard\"\n{\n");
            sb.Append($"\t\"$basetexture\" \"particle/{name}\"\n\t$vertexcolor 1\n\t$vertexalpha 1\n\t$translucent 1\n");
            if (additive) sb.Append("\t$additive 1\n");
            if (overbright is { } ob) sb.Append($"\t$overbrightfactor {ob.ToString(CultureInfo.InvariantCulture)}\n");
            if (nofog) sb.Append("\t$nofog 1\n");
            return sb.Append("}\n").ToString();
        }
        return null;
    }

    // one suffix token's keys; false for a token this naming doesn't know (then the material isn't a variant)
    static bool Suffix(string t, ref bool additive, ref bool nofog, ref double? overbright)
    {
        switch (t)
        {
            case "add": case "additive": additive = true; return true;
            case "nofog": nofog = true; return true;
            case "addnofog": additive = nofog = true; return true;
            case "minsizebig": return true;
        }
        if (Overbright().Match(t) is { Success: true } m) { overbright = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture); return true; }
        return false;
    }
}
