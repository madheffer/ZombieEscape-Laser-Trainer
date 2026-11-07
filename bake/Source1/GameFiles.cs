// Source 1 content lookup, in the engine's order: the map's own pakfile (the zip in lump 40) first, then the
// game's VPKs (CS:GO's csgo/pak01_dir.vpk: stock textures, props, sounds). Paths are case-insensitive with
// forward slashes, as Source's file system treats them. Read-only: nothing here writes anywhere.
using SteamDatabase.ValvePak;

namespace Lasers.Bake.Source1;

sealed class GameFiles : IDisposable
{
    readonly Dictionary<string, PakZip.Entry> pak = new(StringComparer.OrdinalIgnoreCase);
    readonly PakZip? zip;
    readonly List<Package> vpks = [];
    public readonly List<string> Sources = [];

    public GameFiles(byte[] pakfile, IEnumerable<string> vpkPaths)
    {
        if (pakfile.Length > 0)
        {
            try
            {
                zip = new PakZip(pakfile);
                foreach (var e in zip.Entries) if (!e.Name.EndsWith('/')) pak[Norm(e.Name)] = e;
                Sources.Add($"pakfile ({pak.Count} files)");
            }
            catch (Exception e) { Console.WriteLine($"  pakfile unreadable: {e.Message}"); }
        }
        foreach (var p in vpkPaths)
        {
            if (!File.Exists(p)) continue;
            var pkg = new Package();
            pkg.Read(p);
            vpks.Add(pkg);
            Sources.Add(p);
        }
    }

    public static string Norm(string p) => p.Replace('\\', '/').TrimStart('/').ToLowerInvariant();

    public IEnumerable<string> PakFiles => pak.Keys;

    public bool InPak(string path) => pak.ContainsKey(Norm(path));

    public byte[]? Read(string path)
    {
        var n = Norm(path);
        if (zip != null && pak.TryGetValue(n, out var z))
        {
            // a pakfile entry can claim any size: cap what is read (the largest real VTF / MDL is well under this)
            try { return zip.Read(z, 256 << 20); }
            catch (Exception e) when (e is InvalidDataException or IndexOutOfRangeException or EndOfStreamException)
            {
                Console.WriteLine($"  pakfile {n} unreadable: {e.Message}");
                return null;
            }
        }
        foreach (var v in vpks)
        {
            var e = v.FindEntry(n);
            if (e == null) continue;
            v.ReadEntry(e, out var bytes);
            return bytes;
        }
        if (Substitutes.TryGetValue(n, out var sub))
        {
            if (substituted.Add(n)) Console.WriteLine($"  {n}: not in the map or any VPK, substituted ({sub.Why})");
            return System.Text.Encoding.ASCII.GetBytes(sub.Text);
        }
        // a stock particle material variant rebuilt over its base texture (StockVariants)
        if (StockVariants.Vmt(n, Exists) is { } vmt)
        {
            if (substituted.Add(n)) Console.WriteLine($"  {n}: not in the map or any VPK, rebuilt over its base texture");
            return System.Text.Encoding.ASCII.GetBytes(vmt);
        }
        return null;
    }

    // in the pakfile or a VPK (substitutes not counted)
    public bool Exists(string path)
    {
        var n = Norm(path);
        return pak.ContainsKey(n) || vpks.Any(v => v.FindEntry(n) != null);
    }

    // a CS:S map baked without CS:S: what neither the map nor CS:GO has is the game's own content we lack, which its
    // players do have (Source1Particles leaves such a renderer out instead of drawing the error checker)
    public bool ForeignStock { get; set; }

    // CS:S stock files CS:GO's pak doesn't have, for a CS:S map baked without CS:S installed (its VPKs come first when
    // it is). Each stands in with CS:GO content that draws the same; the bake log names every one it used.
    // cs_italy/white: ZE maps' plain white brush texture, tinted by rendercolor (ze_lifeforms' arena plates, its blue and
    // green lasers). UNSETTLED: CS:S's own white.vmt not read (no CS:S here); cs_havana/white.vtf is a solid white 32x32
    // DXT1 (read from CS:GO's pak01), kept lightmapped as a brush texture is.
    static readonly Dictionary<string, (string Text, string Why)> Substitutes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["materials/cs_italy/white.vmt"] = ("\"LightmappedGeneric\"\n{\n\t\"$basetexture\" \"cs_havana/white\"\n}\n", "CS:GO's cs_havana/white, solid white"),
    };
    readonly HashSet<string> substituted = new(StringComparer.OrdinalIgnoreCase);

    public void Dispose()
    {
        foreach (var v in vpks) v.Dispose();
    }
}
