// kv3dump <in dir> <out dir>
// Every compiled resource (*_c) under <in dir> -> its DATA block as KV3 text at <out dir>/<same relative path>.kv3.
// tools/tp-graph.mjs extracts the files from the VPK first (tools/vpk.mjs), so this never sees a VPK path.
using ValveResourceFormat;

if (args.Length < 2) { Console.Error.WriteLine("usage: kv3dump <in dir> <out dir>"); return 2; }
var inRoot = Path.GetFullPath(args[0]);
var outRoot = Path.GetFullPath(args[1]);
int ok = 0, failed = 0;
foreach (var file in Directory.EnumerateFiles(inRoot, "*_c", SearchOption.AllDirectories))
{
    var rel = Path.GetRelativePath(inRoot, file);
    var dest = Path.GetFullPath(Path.Combine(outRoot, rel + ".kv3"));
    if (!dest.StartsWith(outRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) { failed++; continue; }
    try
    {
        using var res = new Resource();
        res.Read(file);
        Directory.CreateDirectory(Path.GetDirectoryName(dest));
        File.WriteAllText(dest, res.DataBlock.ToString());
        ok++;
    }
    catch (Exception e) { Console.Error.WriteLine($"failed: {rel}: {e.Message}"); failed++; }
}
Console.WriteLine($"{ok} dumped, {failed} failed");
return failed > 0 ? 1 : 0;
