namespace Atlas.Domain;

public static class FlowInterfaces
{
    public static List<WaterFlux> Crossings(IEnumerable<FlowLink> links, System.Text.Json.Nodes.JsonObject footprint, bool includeChannels = false)
    {
        var result = new List<WaterFlux>();
        foreach (var link in links.Where(l => includeChannels || !l.Channel))
        {
            var geometry = Spatial.Line([link.A, link.B]);
            var distance = Spatial.Point(link.A).Distance(Spatial.Point(link.B));
            if (distance < 1e-6) continue;
            foreach (var point in Spatial.Crossings(geometry, footprint))
            {
                var direction = Topology.Direction(geometry, footprint, point);
                if (direction is "inlet" or "outlet") result.Add(new(link.Id, point,
                    new((link.B.X - link.A.X) / distance, (link.B.Y - link.A.Y) / distance), link.Rate, direction));
            }
        }
        return result;
    }
}
