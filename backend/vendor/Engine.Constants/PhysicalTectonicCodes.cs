namespace Engine.Constants;

public static class PhysicalCrustTypeCodes
{
    public const int Oceanic = 1;
    public const int Continental = 2;

    public const int Min = Oceanic;
    public const int Max = Continental;
}

public static class PhysicalTectonicBoundaryCodes
{
    public const int None = 0;
    public const int Convergent = 1;
    public const int Divergent = 2;
    public const int Transform = 3;

    public const int Min = None;
    public const int Max = Transform;
}

/// <summary>
/// What the nearest plate boundary is doing to a stretch of crust. Coastlines
/// differ in kind rather than only in raggedness, and the kind is set here:
/// passive margins carry broad shallow shelves and platform peninsulas, rifted
/// margins deep glaciated inlets, convergent margins arcs and offshore island
/// groups, transform margins straight faulted coasts.
/// </summary>
public static class PhysicalMarginCodes
{
    public const int Interior = 0;
    public const int Passive = 1;
    public const int Convergent = 2;
    public const int Rifted = 3;
    public const int Transform = 4;

    public const int Min = Interior;
    public const int Max = Transform;
}
