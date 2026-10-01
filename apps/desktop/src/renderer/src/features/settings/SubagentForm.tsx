import type { ConfigScope } from "../../../../shared/contracts";
import { Button } from "../../components/ui/Button";
import { Field, SelectField, SwitchControl } from "../../components/ui/FormControls";

export type SubagentFormState = {
  path?: string;
  scope: ConfigScope;
  projectCwd: string;
  name: string;
  description: string;
  model: string;
  readOnly: boolean;
  tools: string;
  disallowedTools: string;
  isolation: "shared" | "worktree";
  body: string;
};

export function SubagentForm({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  projects,
}: {
  value: SubagentFormState;
  onChange(value: SubagentFormState): void;
  onSave(): void;
  onCancel(): void;
  saving: boolean;
  projects: { label: string; value: string }[];
}) {
  return (
    <form
      className="grid gap-4 border-y border-hairline py-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        {value.path ? (
          <div className="text-sm text-fg-subtle">
            Location: {value.scope === "user" ? "Home" : "Project"}
          </div>
        ) : (
          <SelectField
            label="Location"
            value={value.scope}
            options={[
              { label: "Home", value: "user" },
              { label: "Project", value: "workspace" },
            ]}
            onChange={(scope) => onChange({ ...value, scope })}
          />
        )}
        {value.scope === "workspace" && projects.length > 1 ? (
          <SelectField
            label="Project"
            value={value.projectCwd}
            options={projects}
            onChange={(projectCwd) => onChange({ ...value, projectCwd })}
          />
        ) : null}
        <Field
          label="Name"
          mono
          placeholder="security-auditor"
          value={value.name}
          onChange={(name) => onChange({ ...value, name })}
        />
        <Field
          label="Model"
          mono
          placeholder="inherit"
          value={value.model}
          onChange={(model) => onChange({ ...value, model })}
        />
      </div>
      <label className="grid gap-2 text-xs text-fg-muted">
        Description
        <textarea
          className="field-control min-h-20 resize-y py-2"
          maxLength={280}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
        />
      </label>
      <div className="flex items-center justify-between gap-4 py-2">
        <span className="text-sm">Readonly</span>
        <SwitchControl
          ariaLabel="Readonly subagent"
          checked={value.readOnly}
          onCheckedChange={(readOnly) => onChange({ ...value, readOnly })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Tools"
          mono
          placeholder="read, grep, web_search"
          value={value.tools}
          onChange={(tools) => onChange({ ...value, tools })}
        />
        <Field
          label="Disallowed tools"
          mono
          placeholder="shell, process"
          value={value.disallowedTools}
          onChange={(disallowedTools) => onChange({ ...value, disallowedTools })}
        />
      </div>
      <SelectField
        label="Isolation"
        value={value.isolation}
        options={[
          { label: "Shared workspace", value: "shared" },
          { label: "Worktree", value: "worktree" },
        ]}
        onChange={(isolation) => onChange({ ...value, isolation })}
      />
      <label className="grid gap-2 text-xs text-fg-muted">
        Instructions
        <textarea
          className="field-control min-h-40 resize-y py-2 font-mono"
          value={value.body}
          onChange={(event) => onChange({ ...value, body: event.target.value })}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={saving} variant="ghost">
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || !value.name.trim() || !value.body.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
