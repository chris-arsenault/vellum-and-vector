using Npgsql;
using NpgsqlTypes;

namespace Atlas.Persistence;

internal static class Sql
{
    internal static NpgsqlCommand Command(NpgsqlConnection connection, string text, params object?[] values)
    {
        var command = new NpgsqlCommand(text, connection);
        foreach (var value in values)
            command.Parameters.Add(value is NpgsqlParameter typed ? typed : new NpgsqlParameter { Value = value ?? DBNull.Value });
        return command;
    }

    internal static NpgsqlParameter Null<T>(T? value, string type) => new() { DataTypeName = type, Value = (object?)value ?? DBNull.Value };
    internal static NpgsqlParameter Uuid(Guid? value) => Null(value, "uuid");
    internal static NpgsqlParameter Text(string? value) => Null(value, "text");
    internal static NpgsqlParameter Number(double? value) => Null(value, "float8");
    internal static T? Optional<T>(NpgsqlDataReader r, string column) => r.IsDBNull(r.GetOrdinal(column)) ? default : r.GetFieldValue<T>(r.GetOrdinal(column));
    internal static T Value<T>(NpgsqlDataReader r, string column) => r.GetFieldValue<T>(r.GetOrdinal(column));

    internal static async Task Execute(NpgsqlConnection connection, string text, params object?[] values)
    {
        await using var command = Command(connection, text, values);
        await command.ExecuteNonQueryAsync();
    }

    internal static async Task<List<T>> Read<T>(NpgsqlConnection connection, string text, Func<NpgsqlDataReader, T> map, params object?[] values)
    {
        await using var command = Command(connection, text, values);
        await using var reader = await command.ExecuteReaderAsync();
        var result = new List<T>();
        while (await reader.ReadAsync()) result.Add(map(reader));
        return result;
    }

    internal static async Task Insert(NpgsqlConnection connection, string table, (string Column, object? Value)[] columns)
    {
        // Table and column identifiers come exclusively from the mappings in this
        // assembly. Every value, including arrays and geometries, is parameterized.
        var names = string.Join(',', columns.Select(c => c.Column));
        var parameters = string.Join(',', Enumerable.Range(1, columns.Length).Select(i => $"${i}"));
        await Execute(connection, $"INSERT INTO {table}({names}) VALUES({parameters})", columns.Select(c => c.Value).ToArray());
    }
}
