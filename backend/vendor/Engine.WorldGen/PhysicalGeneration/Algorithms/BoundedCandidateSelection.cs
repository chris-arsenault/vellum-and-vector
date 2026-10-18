namespace Engine.WorldGen;

/// <summary>
/// Retains the strongest candidates without sorting or retaining the complete
/// generation field. Equal scores retain the original lower-index ordering.
/// </summary>
internal sealed class BoundedCandidateSelection
{
    private readonly PriorityQueue<ScoredIndex, ScoredIndex> _candidates;
    private readonly int _capacity;

    public BoundedCandidateSelection(int capacity)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(capacity);
        _capacity = capacity;
        _candidates = new PriorityQueue<ScoredIndex, ScoredIndex>(
            capacity,
            WorstCandidateComparer.Instance);
    }

    public void Consider(int index, double score)
    {
        var candidate = new ScoredIndex(index, score);
        if (_candidates.Count < _capacity)
        {
            _candidates.Enqueue(candidate, candidate);
            return;
        }

        _candidates.TryPeek(out var weakest, out _);
        if (!IsBetter(candidate, weakest))
        {
            return;
        }

        _candidates.Dequeue();
        _candidates.Enqueue(candidate, candidate);
    }

    public int[] GetBestIndexes()
    {
        var selected = new ScoredIndex[_candidates.Count];
        for (var index = 0; index < selected.Length; index++)
        {
            selected[index] = _candidates.Dequeue();
        }

        Array.Sort(selected, BestCandidateComparer.Instance);
        var indexes = new int[selected.Length];
        for (var index = 0; index < selected.Length; index++)
        {
            indexes[index] = selected[index].Index;
        }

        return indexes;
    }

    private static bool IsBetter(ScoredIndex candidate, ScoredIndex existing) =>
        candidate.Score > existing.Score ||
        (candidate.Score.Equals(existing.Score) && candidate.Index < existing.Index);

    private readonly record struct ScoredIndex(int Index, double Score);

    private sealed class WorstCandidateComparer : IComparer<ScoredIndex>
    {
        public static WorstCandidateComparer Instance { get; } = new();

        public int Compare(ScoredIndex first, ScoredIndex second)
        {
            var score = first.Score.CompareTo(second.Score);
            return score != 0 ? score : second.Index.CompareTo(first.Index);
        }
    }

    private sealed class BestCandidateComparer : IComparer<ScoredIndex>
    {
        public static BestCandidateComparer Instance { get; } = new();

        public int Compare(ScoredIndex first, ScoredIndex second)
        {
            var score = second.Score.CompareTo(first.Score);
            return score != 0 ? score : first.Index.CompareTo(second.Index);
        }
    }
}
