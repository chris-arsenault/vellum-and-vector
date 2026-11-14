import { useState } from "react";

export type Attributes = Record<string, unknown>;
interface Props {
  values: Attributes;
  schema?: Record<string, unknown>;
  change: (values: Attributes) => void;
}
export function AttributeEditor({ values, schema = {}, change }: Props) {
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("string");
  const keys = [...new Set([...Object.keys(schema), ...Object.keys(values)])];
  return (
    <fieldset>
      <legend>Attributes</legend>
      {keys.map((key) => (
        <Attribute
          key={key}
          name={key}
          value={values[key]}
          spec={schema[key] as Spec}
          change={(value) => {
            const next = { ...values };
            if (value === undefined) delete next[key];
            else next[key] = value;
            change(next);
          }}
        />
      ))}
      <div className="form-row">
        <label>
          New attribute
          <input value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label>
          Type
          <select value={newType} onChange={(e) => setNewType(e.target.value)}>
            <option>string</option>
            <option>number</option>
            <option>boolean</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        className="quiet"
        disabled={!newName || keys.includes(newName)}
        onClick={() => {
          change({ ...values, [newName]: initialValue(newType) });
          setNewName("");
        }}
      >
        Add attribute
      </button>
    </fieldset>
  );
}
type Spec = { type?: string; required?: boolean } | undefined;
function initialValue(type: string) {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return "";
}
function valueType(value: unknown) {
  const types: Record<string, string> = { number: "number", boolean: "boolean", object: "json" };
  return types[typeof value] ?? "string";
}
function Attribute({
  name,
  value,
  spec,
  change,
}: {
  name: string;
  value: unknown;
  spec: Spec;
  change: (value: unknown) => void;
}) {
  const type = spec?.type ?? valueType(value);
  return (
    <label>
      {name}
      {spec?.required ? " *" : ""}
      {type === "boolean" ? (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => change(e.target.checked)}
        />
      ) : type === "json" ? (
        <Structured value={value} change={change} />
      ) : (
        <input
          type={type === "number" ? "number" : "text"}
          step="any"
          required={spec?.required}
          value={String(value ?? "")}
          onChange={(e) => change(parseValue(type, e.target.value, spec))}
        />
      )}
    </label>
  );
}
function parseValue(type: string, value: string, spec: Spec) {
  if (!value && !spec?.required) return undefined;
  return type === "number" ? Number(value) : value;
}
function Structured({ value, change }: { value: unknown; change: (value: unknown) => void }) {
  return (
    <details>
      <summary>Structured value</summary>
      <textarea
        defaultValue={JSON.stringify(value, null, 2)}
        onBlur={(e) => {
          try {
            change(JSON.parse(e.target.value) as unknown);
            e.target.setCustomValidity("");
          } catch {
            e.target.setCustomValidity("Enter valid JSON for this structured value.");
            e.target.reportValidity();
          }
        }}
      />
    </details>
  );
}
