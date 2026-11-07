// The pakfile (lump 40) as Source's own zip reader sees it: a plain zip (no zip64, no encryption) whose entries are
// stored (0), deflated (8) or, from `bspzip -repack -compress`, LZMA-packed (14), which System.IO.Compression can't
// open. Read from the central directory; every offset and size comes from an attacker-made file and is bounds-checked.
using System.IO.Compression;
using System.Text;

namespace Lasers.Bake.Source1;

sealed class PakZip
{
    public readonly record struct Entry(string Name, int Method, long Packed, long Size, int LocalHeader);

    readonly byte[] z;
    public readonly List<Entry> Entries = [];

    public PakZip(byte[] zip)
    {
        z = zip;
        // the end of central directory record: the last "PK\5\6" with room for its 22 bytes
        var eocd = -1;
        for (var i = z.Length - 22; i >= Math.Max(0, z.Length - 22 - 65535); i--)
            if (z[i] == 'P' && z[i + 1] == 'K' && z[i + 2] == 5 && z[i + 3] == 6) { eocd = i; break; }
        if (eocd < 0) throw new InvalidDataException("no zip directory");
        int count = U16(eocd + 10), p = I32(eocd + 16);
        for (var k = 0; k < count; k++)
        {
            if (p < 0 || p + 46 > z.Length || I32(p) != 0x02014b50) throw new InvalidDataException("bad zip directory entry");
            int method = U16(p + 10), nameLen = U16(p + 28), extraLen = U16(p + 30), commentLen = U16(p + 32);
            long packed = (uint)I32(p + 20), size = (uint)I32(p + 24);
            var local = I32(p + 42);
            if (p + 46 + nameLen > z.Length) throw new InvalidDataException("bad zip entry name");
            var name = Encoding.UTF8.GetString(z, p + 46, nameLen);
            Entries.Add(new Entry(name, method, packed, size, local));
            p += 46 + nameLen + extraLen + commentLen;
        }
    }

    public byte[] Read(Entry e, long cap)
    {
        if (e.Size > cap) throw new InvalidDataException("zip entry too large");
        var h = e.LocalHeader;
        if (h < 0 || h + 30 > z.Length || I32(h) != 0x04034b50) throw new InvalidDataException("bad zip local header");
        long start = h + 30L + U16(h + 26) + U16(h + 28);
        if (start + e.Packed > z.Length) throw new InvalidDataException("zip entry outside the pakfile");
        var data = z.AsSpan((int)start, (int)e.Packed);
        switch (e.Method)
        {
            case 0: return data.ToArray();
            case 8:
            {
                using var s = new DeflateStream(new MemoryStream(data.ToArray()), CompressionMode.Decompress);
                var outp = new byte[e.Size];
                s.ReadExactly(outp);
                return outp;
            }
            case 14: return Lzma.DecodeZipEntry(data, e.Size);
            default: throw new InvalidDataException($"zip method {e.Method}");
        }
    }

    int U16(int o) => BitConverter.ToUInt16(z, o);
    int I32(int o) => BitConverter.ToInt32(z, o);
}
