namespace Engine.WorldGen;

public static class PhysicalNoise
{
    // Fixed per-octave rotation (golden angle) so octave lattices never share
    // axes; axis-aligned stripes and diamond level sets cancel across octaves.
    private static readonly double RotationCos = Math.Cos(2.39996322972865332d);
    private static readonly double RotationSin = Math.Sin(2.39996322972865332d);

    public static double UnitNoise(double x, double y, int salt, double scale, int octaves) =>
        (FractalNoise(x, y, salt, scale, octaves) + 1d) * 0.5d;

    public static double FractalNoise(double x, double y, int salt, double scale, int octaves)
    {
        var amplitude = 1d;
        var amplitudeTotal = 0d;
        var value = 0d;
        var cos = 1d;
        var sin = 0d;
        for (var octave = 0; octave < octaves; octave++)
        {
            var rotatedX = (x * cos) - (y * sin);
            var rotatedY = (x * sin) + (y * cos);
            value += ValueNoise(
                rotatedX / scale,
                rotatedY / scale,
                salt + (octave * 7919)) * amplitude;
            amplitudeTotal += amplitude;
            amplitude *= 0.5d;
            scale *= 0.5d;
            var nextCos = (cos * RotationCos) - (sin * RotationSin);
            var nextSin = (cos * RotationSin) + (sin * RotationCos);
            cos = nextCos;
            sin = nextSin;
        }

        return value / amplitudeTotal;
    }

    public static double HashSigned(int salt, int x, int y) => (HashUnit(salt, x, y) * 2d) - 1d;

    public static double HashUnit(int salt, int x, int y)
    {
        unchecked
        {
            // splitmix64-style finalizer over the packed coordinates; every
            // input bit avalanches so neighboring lattice cells decorrelate.
            var z = ((ulong)(uint)x << 32) | (uint)y;
            z += (ulong)(uint)salt * 0x9E3779B97F4A7C15UL;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            z ^= z >> 31;
            return (z >> 11) * (1d / 9007199254740992d);
        }
    }

    private static double ValueNoise(double x, double y, int salt)
    {
        var x0 = (int)Math.Floor(x);
        var y0 = (int)Math.Floor(y);
        var tx = Smooth(x - x0);
        var ty = Smooth(y - y0);
        var a = Lerp(HashSigned(salt, x0, y0), HashSigned(salt, x0 + 1, y0), tx);
        var b = Lerp(HashSigned(salt, x0, y0 + 1), HashSigned(salt, x0 + 1, y0 + 1), tx);
        return Lerp(a, b, ty);
    }

    private static double Smooth(double value) => value * value * (3d - (2d * value));

    private static double Lerp(double first, double second, double amount) =>
        first + ((second - first) * amount);
}
