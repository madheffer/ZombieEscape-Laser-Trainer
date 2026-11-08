// The map's own precomputed visibility (CS2's world_visibility.vvis_c, VRF VoxelVisibility), for culling what can't be
// seen from where the camera is (web/src/world/vis.js; tools/chunk-world.mjs tags world meshes with their clusters).
//
//   lasers-bake --vis <workshop.vpk> <web/public/maps/<name>>   (the full bake writes it too)
//
// CS2 splits the map into up to 4096 clusters (voxel regions) and stores, per cluster, the bit set of clusters visible
// from it (PVS). The voxel tree itself is far too big to ship (offliner: 3M nodes, 39 MB), so the cluster volumes
// (VRF BuildClusterChildBounds) are rasterised into Cell-unit cells, each with the clusters touching it: a point's
// cell names a superset of its cluster, so the union of those clusters' rows never hides what CS2 would draw.
//
// -> vis.bin (gzip), little-endian:
//   "LVIS" u32 version (1), u32 clusters, u32 pvsBytes, u32 cell, u32 runs, u32 lists, u32 ids
//   runs (cells in columns: sorted by x, y, then z; z..z+len-1 share one cluster list):
//     i16 x[runs], i16 y[runs], i16 z[runs], u16 len[runs], u32 list[runs]
//   lists: u32 start[lists + 1], u16 ids[ids]
//   pvs: u8[clusters * pvsBytes] (bit c of row r: cluster c is visible from cluster r; a row with no probe point is
//   all ones)
// manifest.json gets "vis": "vis.bin" (and, from --vis alone, a new version: its chunks are re-cut next).
//
// Everything here comes from the VPK (untrusted): counts and the cell total are capped, the output name is fixed.
using System.IO.Compression;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using SteamDatabase.ValvePak;
using ValveResourceFormat.Blocks;
using ValveResourceFormat.IO;

namespace Lasers.Bake;

static class VisBake
{
    public const string File = "vis.bin";
    const int Cell = 256;
    const int MaxClusters = 65535;
    const int MaxCells = 4_000_000;

    public static int Run(string vpk, string mapDir)
    {
        var manifestPath = Path.Combine(mapDir, "manifest.json");
        if (!System.IO.File.Exists(manifestPath)) { Console.Error.WriteLine($"not a baked map folder: {mapDir}"); return 1; }
        var mapName = Path.GetFileName(mapDir.TrimEnd('/', '\\'));
        var outer = new Package();
        outer.Read(vpk);
        Package map = outer;
        if (outer.Entries.TryGetValue("vpk", out var vpks))
        {
            var inner = vpks.FirstOrDefault(e => e.DirectoryName == "maps" && string.Equals(e.FileName, mapName, StringComparison.OrdinalIgnoreCase));
            if (inner != null)
            {
                outer.ReadEntry(inner, out var bytes);
                map = new Package();
                map.SetFileName(inner.GetFullPath());
                map.Read(new MemoryStream(bytes));
            }
        }
        using var loader = new GameFileLoader(map, null);
        if (!Write(loader, mapName, mapDir, Console.WriteLine)) return 0;
        var manifest = JsonNode.Parse(System.IO.File.ReadAllText(manifestPath))!.AsObject();
        manifest["vis"] = File;
        // the chunks are cut again with the vis tags next (tools/chunk-world.mjs): a new version, or browsers keep the
        // old chunk files they cached under the old one (every map file is fetched as ?v=<version>)
        manifest["version"] = DateTime.UtcNow.ToString("yyyyMMddHHmmss");
        System.IO.File.WriteAllText(manifestPath, manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }

    // -> whether vis.bin was written (a map compiled without visibility has none: everything is drawn)
    public static bool Write(GameFileLoader loader, string mapName, string mapDir, Action<string> log)
    {
        var res = loader.LoadFile($"maps/{mapName}/world_visibility.vvis_c");
        var vv = res?.Blocks.OfType<VoxelVisibility>().FirstOrDefault();
        var outFile = Path.Combine(mapDir, File);
        if (vv == null || vv.BaseClusterCount == 0 || vv.BaseClusterCount > MaxClusters || vv.PVSBytesPerCluster * 8 < vv.BaseClusterCount)
        {
            if (System.IO.File.Exists(outFile)) System.IO.File.Delete(outFile);
            log("vis: none");
            return false;
        }
        var clusters = (int)vv.BaseClusterCount;
        var bounds = vv.BuildClusterChildBounds();

        // cells -> clusters touching them
        var cells = new Dictionary<(int, int, int), SortedSet<ushort>>();
        foreach (var (cid, boxes) in bounds)
        {
            if (cid >= clusters) continue; // the sky / sun clusters have no PVS row
            foreach (var (a, b) in boxes)
            {
                int x0 = Floor(a.X), y0 = Floor(a.Y), z0 = Floor(a.Z);
                int x1 = Floor(b.X - 0.01f), y1 = Floor(b.Y - 0.01f), z1 = Floor(b.Z - 0.01f);
                for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++)
                {
                    if (!cells.TryGetValue((x, y, z), out var s))
                    {
                        if (cells.Count >= MaxCells) throw new InvalidDataException("vis: too many cells");
                        cells[(x, y, z)] = s = [];
                    }
                    s.Add(cid);
                }
            }
        }

        // distinct cluster lists, and z runs of one list per column
        var listIds = new Dictionary<string, int>();
        var lists = new List<ushort[]>();
        int ListOf(SortedSet<ushort> s)
        {
            var key = string.Join(',', s);
            if (!listIds.TryGetValue(key, out var i)) { listIds[key] = i = lists.Count; lists.Add([.. s]); }
            return i;
        }
        var runs = new List<(int x, int y, int z, int n, int list)>();
        foreach (var column in cells.GroupBy(kv => (kv.Key.Item1, kv.Key.Item2)).OrderBy(g => g.Key.Item1).ThenBy(g => g.Key.Item2))
        {
            (int x, int y, int z, int n, int list)? cur = null;
            foreach (var kv in column.OrderBy(kv => kv.Key.Item3))
            {
                var id = ListOf(kv.Value);
                if (cur is { } c && c.list == id && c.z + c.n == kv.Key.Item3 && c.n < ushort.MaxValue) cur = c with { n = c.n + 1 };
                else { if (cur != null) runs.Add(cur.Value); cur = (column.Key.Item1, column.Key.Item2, kv.Key.Item3, 1, id); }
            }
            if (cur != null) runs.Add(cur.Value);
        }

        // each cluster's row, read at a point inside it (VRF answers by position)
        var pvsBytes = (int)vv.PVSBytesPerCluster;
        var pvs = new byte[clusters * pvsBytes];
        var noProbe = 0;
        for (var c = 0; c < clusters; c++)
        {
            byte[]? row = null;
            if (bounds.TryGetValue((ushort)c, out var boxes))
                foreach (var (a, b) in boxes)
                {
                    var p = (a + b) / 2;
                    if (vv.GetClusterForPosition(p) != c) continue;
                    row = vv.GetPVSForPoint(p);
                    if (row != null && row.Length >= pvsBytes) break;
                    row = null;
                }
            if (row == null) { noProbe++; Array.Fill(pvs, (byte)0xff, c * pvsBytes, pvsBytes); }
            else Array.Copy(row, 0, pvs, c * pvsBytes, pvsBytes);
        }

        var tmp = outFile + ".tmp";
        using (var fs = System.IO.File.Create(tmp))
        using (var gz = new GZipStream(fs, CompressionLevel.SmallestSize))
        using (var w = new BinaryWriter(gz))
        {
            w.Write("LVIS"u8);
            foreach (var v in new[] { 1, clusters, pvsBytes, Cell, runs.Count, lists.Count, lists.Sum(l => l.Length) }) w.Write(v);
            foreach (var r in runs) w.Write(checked((short)r.x));
            foreach (var r in runs) w.Write(checked((short)r.y));
            foreach (var r in runs) w.Write(checked((short)r.z));
            foreach (var r in runs) w.Write((ushort)r.n);
            foreach (var r in runs) w.Write(r.list);
            var start = 0;
            foreach (var l in lists) { w.Write(start); start += l.Length; }
            w.Write(start);
            foreach (var l in lists) foreach (var c in l) w.Write(c);
            w.Write(pvs);
        }
        System.IO.File.Move(tmp, outFile, true);
        log($"vis: {clusters} clusters, {cells.Count} cells -> {runs.Count} runs, {lists.Count} lists, {noProbe} rows without a probe point, {new FileInfo(outFile).Length / 1024} KB");
        return true;
    }

    static int Floor(float v) => (int)MathF.Floor(v / Cell);
}
