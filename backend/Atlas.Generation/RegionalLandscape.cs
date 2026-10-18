using Atlas.Domain;

namespace Atlas.Generation;

public static class RegionalLandscape
{
    public static (double[] Melt, double Change, double Import, double Export) Ice(RegionalGrid grid, double years, bool recordHistory, bool abrade = true)
    {
        var melt = new double[grid.Count];
        var before = grid["ice"].ToArray();
        for (var i = 0; i < grid.Count; i++)
        {
            if (!grid.Interior[i]) continue;
            var snow = Math.Max(0, grid["snowfall"][i]) * .001 * years;
            var available = before[i] + snow;
            var melting = Math.Min(available, Math.Max(0, grid["temperature"][i] - 300) * .002 * years + snow * (1 - grid.IceScale));
            if (grid.Fixed("ice", i)) melting = snow;
            grid["ice"][i] = available - melting;
            melt[i] = melting * grid.Measures[i];
        }
        var delta = new double[grid.Count];
        double imported = 0, exported = 0;
        for (var i = 0; i < grid.Count; i++)
        {
            if (grid["ice"][i] <= 0) continue;
            var surface = grid["elevation"][i] + grid["ice"][i];
            var candidates = grid.Neighbors(i).Where(n => grid.Interior[i] || grid.Interior[n]).ToList();
            if (candidates.Count == 0) continue;
            var target = candidates.MinBy(n => grid["elevation"][n] + grid["ice"][n]);
            var mutableSource = grid.Interior[i] && !grid.Fixed("ice", i);
            var mutableTarget = grid.Interior[target] && !grid.Fixed("ice", target);
            if (!mutableSource && !mutableTarget) continue;
            var fall = surface - grid["elevation"][target] - grid["ice"][target];
            if (fall <= 0) continue;
            var slope = fall / Math.Sqrt(Math.Pow(grid.Position(i).X - grid.Position(target).X, 2) + Math.Pow(grid.Position(i).Y - grid.Position(target).Y, 2));
            var transfer = Math.Min(grid["ice"][i] * .2, fall * .1 * Math.Min(1, years * slope));
            var volume = transfer * (grid.Interior[i] ? grid.Measures[i] : grid.CellArea);
            if (mutableSource) delta[i] -= volume / grid.Measures[i];
            if (mutableTarget) delta[target] += volume / grid.Measures[target];
            if (!mutableSource && mutableTarget) imported += volume;
            if (mutableSource && !mutableTarget) exported += volume;
            grid["iceFlux"][i] = volume / years;
            if (recordHistory && abrade && !grid.Fixed("elevation", i) && !grid.Fixed("elevation", target))
            {
                var requested = Math.Min(transfer * slope * .001 / Math.Max(.05, grid["rock"][i] / 1000), .1);
                var abrasion = Math.Min(-grid.AvailableChange("elevation", i, -requested), grid.AvailableChange("elevation", target, requested) * grid.Measures[target] / grid.Measures[i]);
                var deposit = abrasion * grid.Measures[i] / grid.Measures[target];
                grid["elevation"][i] -= abrasion; grid["bedrock"][i] -= abrasion;
                grid["glacialErosion"][i] += abrasion;
                grid["sediment"][target] += deposit; grid["elevation"][target] += deposit;
                grid["glacialDeposition"][target] += deposit;
            }
        }
        double change = 0;
        for (var i = 0; i < grid.Count; i++)
        {
            grid["ice"][i] += delta[i];
            if (grid.Interior[i]) change += (grid["ice"][i] - before[i]) * grid.Measures[i];
            if (recordHistory) grid["glacialHistory"][i] = Math.Max(grid["glacialHistory"][i], grid["ice"][i]);
        }
        return (melt, change, imported, exported);
    }

    public static PhysicalBudget Transport(RegionalGrid grid, PhysicalBudget budget, double years, bool erode = true)
    {
        var carried = grid.PendingSediment.ToArray();
        grid.ReceivingSediment.Clear();
        var channelLoad = new double[grid.Count];
        double produced = carried.Sum(), deposited = 0, exported = 0;
        var oldSuspended = Enumerable.Range(0, grid.Count).Where(i => grid.Interior[i]).Sum(i => grid["suspendedSediment"][i] * grid.Measures[i]) + grid.Waters.Basins.Values.Sum(b => b.State.Suspended);
        foreach (var i in Enumerable.Range(0, grid.Count).Where(i => grid.Interior[i]))
        {
            carried[i] += grid["suspendedSediment"][i] * grid.Measures[i]; grid["suspendedSediment"][i] = 0;
        }
        Array.Clear(grid.PendingSediment);
        var surface = grid.Surface!.Materials(carried, channelLoad, years, erode);
        produced += surface.Produced; deposited += surface.Deposited; exported += surface.Exported;
        var channels = new ChannelTransport(grid).Sediment(channelLoad, years);
        exported += channels.Exported; deposited += channels.Deposited;
        var storage = Enumerable.Range(0, grid.Count).Where(i => grid.Interior[i]).Sum(i => grid["suspendedSediment"][i] * grid.Measures[i]) + grid.Waters.Basins.Values.Sum(b => b.State.Suspended) - oldSuspended;
        Guard.Require(Math.Abs(produced - deposited - exported - storage) <= Math.Max(1e-6, (produced + oldSuspended) * 1e-9), "sediment_conservation", "Sediment production, retention and export did not balance.");
        return budget with { SedimentProduced = produced, SedimentDeposited = deposited, SedimentExported = exported, SedimentStorageChange = storage };
    }

    public static void HillslopesAndCoasts(RegionalGrid grid, double years, bool hillslopes = true)
    {
        foreach (var i in Enumerable.Range(0, grid.Count).Where(i => grid.Mutable[i]))
        {
            var neighbors = grid.Neighbors(i).Where(n => grid.Interior[n] && !grid.Fixed("elevation", n)).ToList();
            if (neighbors.Count == 0 || grid.Fixed("elevation", i)) continue;
            var target = neighbors.MinBy(n => grid["elevation"][n]);
            var distance = Spatial.Point(grid.Position(i)).Distance(Spatial.Point(grid.Position(target)));
            var excess = grid["elevation"][i] - grid["elevation"][target] - distance * .65;
            var slopeTransfer = hillslopes ? Math.Max(0, excess * .1) : 0;
            var coastal = grid["elevation"][i] >= 0 && grid["elevation"][target] < 0;
            var waveTransfer = coastal ? years * .001 / Math.Max(.05, grid["rock"][i] / 1000) *
                (1 + Math.Abs(grid["windX"][target]) / 1000 + Math.Abs(grid["windY"][target]) / 1000 + Math.Abs(grid["magicCoastal"][target]) / 100) : 0;
            var amount = Math.Min(-grid.AvailableChange("elevation", i, -slopeTransfer - waveTransfer),
                grid.AvailableChange("elevation", target, slopeTransfer + waveTransfer) * grid.Measures[target] / grid.Measures[i]);
            if (amount <= 0) continue;
            var loose = Math.Min(grid["sediment"][i], amount);
            var previousCover = grid["sediment"][target];
            grid["sediment"][i] -= loose; grid["bedrock"][i] -= amount - loose; grid["elevation"][i] -= amount;
            var received = amount * grid.Measures[i] / grid.Measures[target];
            grid["sediment"][target] += received; grid["elevation"][target] += received; grid["deposition"][target] += received;
            grid["carbonate"][target] = (grid["carbonate"][target] * previousCover + grid["carbonate"][i] * received) / Math.Max(1e-10, previousCover + received);
            grid[coastal ? "coastalErosion" : "massWasting"][i] += amount;
        }
    }
}
