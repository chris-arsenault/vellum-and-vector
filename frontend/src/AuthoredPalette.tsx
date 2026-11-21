import { Icon } from "./AuthoredIcons";
import { chooseAuthoredTool } from "./authoredActions";
import { authoredTools, toolGroupsFor, toolTitle } from "./authoredState";
import type { AuthoringSession } from "./useRealScaleAuthoring";

/** The tools in their groups: Edit, Land, Elevation, Water, Places. The pressed tool is the
 * one in hand; each tooltip names its key. */
export function AuthoredPalette({ session }: { session: AuthoringSession }) {
  const active = session.state.authored.tool;
  return (
    <div role="toolbar" aria-label="Authoring tools" className="authored-palette">
      {toolGroupsFor(session.map.profile).map((group) => (
        <div role="group" aria-label={group} className="authored-group" key={group}>
          <span className="authored-group-name">{group}</span>
          <div className="authored-tools">
            {authoredTools
              .filter((tool) => tool.group === group)
              .map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className="authored-tool"
                  aria-pressed={active === tool.id}
                  aria-keyshortcuts={tool.key}
                  title={toolTitle(tool)}
                  onClick={() => chooseAuthoredTool(session, tool.id)}
                >
                  <Icon name={tool.id} />
                  <span>{tool.label}</span>
                  <kbd>{tool.key}</kbd>
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
