using System.Text.Json.Nodes;

namespace Atlas.Domain;

public static class BuiltinLayers
{
    public static Dictionary<string, Layer> Create()
    {
        var layers = new[] {
            Define("elevation", "Elevation", "physical", "field", "#aaa183", "physical"),
            Define("geology", "Geology", "physical", "field", "#998477", "physical"),
            Define("climate", "Climate", "water", "field", "#80a89b", "physical"),
            Define("rivers", "Rivers", "water", "network", "#71c4de", "physical"),
            Define("lakes", "Lakes", "water", "vector", "#67aabe", "physical"),
            Define("magic", "Magical forces", "magic", "field", "#c199ee", "magic"),
            Define("roads", "Roads & routes", "transport", "network", "#d9b779", "built"),
            Define("settlements", "Settlements", "built", "vector", "#f2dab0", "built"),
            Define("structures", "Structures & rooms", "built", "vector", "#d7b98f", "built"),
            Define("sovereignty", "Sovereignty", "political", "vector", "#d49f79", "political"),
            Define("administration", "Administration", "political", "vector", "#b9a46d", "political"),
            Define("claims", "Territorial claims", "political", "vector", "#d8b36c", "political"),
            Define("control", "Effective control", "political", "vector", "#ac7f97", "political"),
            Define("cultures", "Cultural prevalence", "cultural", "field", "#87b7a0", "cultural"),
            Define("languages", "Languages", "cultural", "field", "#9aa7d4", "cultural"),
            Define("religions", "Religions & traditions", "cultural", "field", "#bc9bc7", "cultural"),
            Define("pois", "Places of interest", "custom", "vector", "#f0cc7c", null)
        };
        return layers.ToDictionary(x => x.Id);
    }

    private static Layer Define(string id, string name, string family, string representation, string color, string? generator) =>
        new(id, name, family, representation, color, Enum.GetValues<Profile>().ToList(), new JsonObject(), generator);
}
