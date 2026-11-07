// LZMA (the LZMA1 "alone" coder) as Source 1's compressed maps use it: `bspzip -repack -compress` stores each lump,
// each game lump and each pakfile entry LZMA-packed (CS:S since the 2013 SDK update, some CS:GO maps).
// The decoder follows Igor Pavlov's public-domain LzmaSpec.cpp: a range decoder over adaptive bit models.
// Everything here comes from an attacker-made file: sizes are capped, every distance is checked against the bytes
// already written, and a short or corrupt stream throws InvalidDataException rather than reading out of bounds.
namespace Lasers.Bake.Source1;

static class Lzma
{
    // Source's lzma_header_t (public/tier1/lzmaDecoder.h): 'LZMA', actualSize, lzmaSize, properties[5], then the data
    public const int SourceHeaderSize = 17;
    const uint SourceId = 0x414D5A4C; // "LZMA" little-endian
    public const int MaxOutput = 512 << 20;

    public static bool IsSourceLzma(ReadOnlySpan<byte> d) => d.Length >= SourceHeaderSize && BitConverter.ToUInt32(d) == SourceId;

    // A Source lzma_header_t block (a lump, a game lump) -> its bytes
    public static byte[] DecodeSource(ReadOnlySpan<byte> d)
    {
        if (!IsSourceLzma(d)) throw new InvalidDataException("not a Source LZMA block");
        var actual = BitConverter.ToUInt32(d[4..]);
        var packed = BitConverter.ToUInt32(d[8..]);
        if (actual > MaxOutput) throw new InvalidDataException("LZMA block too large");
        var data = d[SourceHeaderSize..];
        if (packed < data.Length) data = data[..(int)packed];
        return Decode(d.Slice(12, 5), data, (int)actual);
    }

    // A zip entry stored with method 14 (APPNOTE 5.8.8): version (2), properties size (2), properties, data
    public static byte[] DecodeZipEntry(ReadOnlySpan<byte> d, long size)
    {
        if (d.Length < 4) throw new InvalidDataException("short LZMA zip entry");
        int propSize = BitConverter.ToUInt16(d[2..]);
        if (propSize < 5 || 4 + propSize > d.Length) throw new InvalidDataException("bad LZMA zip properties");
        if (size < 0 || size > MaxOutput) throw new InvalidDataException("LZMA entry too large");
        return Decode(d.Slice(4, 5), d[(4 + propSize)..], (int)size);
    }

    const int NumStates = 12, PosBitsMax = 4, EndPosModelIndex = 14, NumFullDistances = 128, NumAlignBits = 4, NumLenToPosStates = 4;
    const ushort ProbInit = 1024;

    // Raw LZMA1 data -> exactly outSize bytes (Source's streams carry no end marker; one that does stops early)
    public static byte[] Decode(ReadOnlySpan<byte> props, ReadOnlySpan<byte> src, int outSize)
    {
        int d = props[0];
        if (d >= 9 * 5 * 5) throw new InvalidDataException("bad LZMA properties");
        int lc = d % 9, lp = d / 9 % 5, pb = d / 45;
        var output = new byte[outSize];
        var rc = new RangeDecoder(src);
        var literals = Probs(0x300 << (lc + lp));
        var isMatch = Probs(NumStates << PosBitsMax);
        var isRep = Probs(NumStates);
        var isRepG0 = Probs(NumStates);
        var isRepG1 = Probs(NumStates);
        var isRepG2 = Probs(NumStates);
        var isRep0Long = Probs(NumStates << PosBitsMax);
        var posSlot = Probs(NumLenToPosStates << 6);
        var posDecoders = Probs(1 + NumFullDistances - EndPosModelIndex);
        var align = Probs(1 << NumAlignBits);
        var len = new LenDecoder();
        var repLen = new LenDecoder();

        int pos = 0, state = 0;
        uint rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
        int pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
        while (pos < outSize)
        {
            var posState = pos & pbMask;
            if (rc.Bit(ref isMatch[(state << PosBitsMax) + posState]) == 0)
            {
                // literal: coded with the previous byte's top lc bits (and, after a match, the byte at rep0)
                int prev = pos > 0 ? output[pos - 1] : 0;
                var baseIdx = 0x300 * (((pos & lpMask) << lc) + (prev >> (8 - lc)));
                uint symbol = 1;
                if (state >= 7)
                {
                    int matchByte = output[Back(pos, rep0)];
                    do
                    {
                        var matchBit = (uint)(matchByte >> 7) & 1;
                        matchByte <<= 1;
                        var bit = rc.Bit(ref literals[baseIdx + (int)(((1 + matchBit) << 8) + symbol)]);
                        symbol = (symbol << 1) | bit;
                        if (matchBit != bit) break;
                    } while (symbol < 0x100);
                }
                while (symbol < 0x100) symbol = (symbol << 1) | rc.Bit(ref literals[baseIdx + (int)symbol]);
                output[pos++] = (byte)symbol;
                state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
                continue;
            }
            uint length;
            if (rc.Bit(ref isRep[state]) != 0)
            {
                if (pos == 0) throw new InvalidDataException("LZMA rep match at the start");
                if (rc.Bit(ref isRepG0[state]) == 0)
                {
                    if (rc.Bit(ref isRep0Long[(state << PosBitsMax) + posState]) == 0)
                    {
                        // short rep: one byte from rep0
                        state = state < 7 ? 9 : 11;
                        output[pos] = output[Back(pos, rep0)];
                        pos++;
                        continue;
                    }
                }
                else
                {
                    uint dist;
                    if (rc.Bit(ref isRepG1[state]) == 0) dist = rep1;
                    else
                    {
                        if (rc.Bit(ref isRepG2[state]) == 0) dist = rep2;
                        else { dist = rep3; rep3 = rep2; }
                        rep2 = rep1;
                    }
                    rep1 = rep0;
                    rep0 = dist;
                }
                length = repLen.Decode(ref rc, posState);
                state = state < 7 ? 8 : 11;
            }
            else
            {
                rep3 = rep2; rep2 = rep1; rep1 = rep0;
                length = len.Decode(ref rc, posState);
                state = state < 7 ? 7 : 10;
                rep0 = DecodeDistance(ref rc, length, posSlot, posDecoders, align);
                if (rep0 == 0xFFFFFFFF) break; // end marker
            }
            length += 2;
            var from = Back(pos, rep0);
            for (var i = 0; i < length && pos < outSize; i++) output[pos++] = output[from + i];
        }
        if (pos < outSize) throw new InvalidDataException("LZMA stream ended early");
        return output;
    }

    // the index rep0 + 1 bytes back, which must already be written
    static int Back(int pos, uint rep0)
    {
        if (rep0 >= (uint)pos) throw new InvalidDataException("LZMA distance past the start");
        return pos - (int)rep0 - 1;
    }

    static uint DecodeDistance(ref RangeDecoder rc, uint len, ushort[] posSlot, ushort[] posDecoders, ushort[] align)
    {
        var lenState = (int)Math.Min(len, NumLenToPosStates - 1);
        var slot = rc.Tree(posSlot, lenState << 6, 6);
        if (slot < 4) return slot;
        var numDirect = (int)(slot >> 1) - 1;
        var dist = (2 | (slot & 1)) << numDirect;
        if (slot < EndPosModelIndex) return dist + rc.ReverseTree(posDecoders, (int)(dist - slot), numDirect);
        dist += rc.Direct(numDirect - NumAlignBits) << NumAlignBits;
        return dist + rc.ReverseTree(align, 0, NumAlignBits);
    }

    static ushort[] Probs(int n) { var a = new ushort[n]; Array.Fill(a, ProbInit); return a; }

    sealed class LenDecoder
    {
        ushort choice = ProbInit, choice2 = ProbInit;
        readonly ushort[] low = Probs(16 << 3), mid = Probs(16 << 3), high = Probs(256);

        public uint Decode(ref RangeDecoder rc, int posState)
        {
            if (rc.Bit(ref choice) == 0) return rc.Tree(low, posState << 3, 3);
            if (rc.Bit(ref choice2) == 0) return 8 + rc.Tree(mid, posState << 3, 3);
            return 16 + rc.Tree(high, 0, 8);
        }
    }

    ref struct RangeDecoder
    {
        readonly ReadOnlySpan<byte> src;
        int p;
        uint range, code;

        public RangeDecoder(ReadOnlySpan<byte> s)
        {
            src = s;
            p = 0;
            range = 0xFFFFFFFF;
            code = 0;
            if (Next() != 0) throw new InvalidDataException("bad LZMA stream start");
            for (var i = 0; i < 4; i++) code = (code << 8) | Next();
        }

        byte Next() => p < src.Length ? src[p++] : throw new InvalidDataException("LZMA data truncated");

        void Normalize()
        {
            if (range >= 1u << 24) return;
            range <<= 8;
            code = (code << 8) | Next();
        }

        public uint Bit(ref ushort prob)
        {
            var bound = (range >> 11) * prob;
            uint bit;
            if (code < bound) { prob += (ushort)(((1 << 11) - prob) >> 5); range = bound; bit = 0; }
            else { prob -= (ushort)(prob >> 5); code -= bound; range -= bound; bit = 1; }
            Normalize();
            return bit;
        }

        public uint Direct(int numBits)
        {
            uint res = 0;
            for (; numBits > 0; numBits--)
            {
                range >>= 1;
                code -= range;
                var t = 0u - (code >> 31);
                code += range & t;
                if (code == range) throw new InvalidDataException("corrupt LZMA direct bits");
                Normalize();
                res = (res << 1) + (t + 1);
            }
            return res;
        }

        public uint Tree(ushort[] probs, int baseIdx, int numBits)
        {
            uint m = 1;
            for (var i = 0; i < numBits; i++) m = (m << 1) + Bit(ref probs[baseIdx + (int)m]);
            return m - (1u << numBits);
        }

        public uint ReverseTree(ushort[] probs, int baseIdx, int numBits)
        {
            uint m = 1, symbol = 0;
            for (var i = 0; i < numBits; i++)
            {
                var bit = Bit(ref probs[baseIdx + (int)m]);
                m = (m << 1) + bit;
                symbol |= bit << i;
            }
            return symbol;
        }
    }
}
