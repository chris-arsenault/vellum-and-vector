namespace Engine.WorldGen;

public interface IMapGenerationLayer<in TMap, in TContext>
{
    void Apply(TMap map, TContext context);

    void Validate(TMap map, TContext context);
}
