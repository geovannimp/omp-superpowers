import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EXTREMELY_IMPORTANT_MARKER = "<EXTREMELY_IMPORTANT>";
const BOOTSTRAP_MARKER = "superpowers:using-superpowers bootstrap for pi";
const BUILDER_CHECK_AGENT = "planner";
const IMPLEMENTATION_AGENTS: Record<string, true> = {
	"sdd-implementer": true,
	"sdd-escalation-implementer": true,
};

const extensionDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(extensionDir, "../..");
const skillsDir = resolve(packageRoot, "skills");
const bootstrapSkillPath = resolve(skillsDir, "using-superpowers", "SKILL.md");

let cachedBootstrap: string | null | undefined;

export default function superpowersPiExtension(pi: ExtensionAPI) {
	let injectBootstrap = true;
	let builderCheckDispatched = false;

	pi.on("session_start", async () => {
		injectBootstrap = true;
		builderCheckDispatched = false;
	});

	pi.on("session_compact", async () => {
		injectBootstrap = true;
	});

	// The brainstorming builder check is a subagent dispatch, so prose alone
	// cannot guarantee it happened. Gate the first implementation seat on a
	// planner dispatch in this main session; reviews stay ungated so an
	// existing branch can still be reviewed.
	pi.on("tool_call", async (event, ctx) => {
		if (ctx?.agent?.kind === "sub") return;
		if (event.toolName !== "task") return;

		const agents = taskAgentNames(event.input);
		const needsBuilderCheck = agents.some((agent) => IMPLEMENTATION_AGENTS[agent]);
		if (needsBuilderCheck && !builderCheckDispatched) {
			return {
				block: true,
				reason:
					'Superpowers: dispatch the planner builder check before the first implementation subagent. Read skill://brainstorming\'s Builder check, write the design, then call task with agent "planner" and builder-check-prompt.md. Reviews and final review are not gated.',
			};
		}

		if (agents.includes(BUILDER_CHECK_AGENT)) {
			builderCheckDispatched = true;
		}
	});

	// Messages returned from a context handler are sent to the provider but never
	// written to session history, so the bootstrap has to be injected into every
	// provider request, on every prompt, for the whole session.
	pi.on("context", async (event, ctx) => {
		if (ctx?.agent?.kind === "sub") return;
		if (!injectBootstrap) return;
		if (event.messages.some(messageContainsBootstrap)) return;

		const bootstrap = getBootstrapContent();
		if (!bootstrap) return;

		const bootstrapMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: bootstrap }],
			timestamp: Date.now(),
		};

		const insertAt = firstNonCompactionSummaryIndex(event.messages);
		return {
			messages: [
				...event.messages.slice(0, insertAt),
				bootstrapMessage,
				...event.messages.slice(insertAt),
			],
		};
	});
}

function taskAgentNames(input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const tasks = "tasks" in input ? input.tasks : undefined;
	const items = Array.isArray(tasks) ? tasks : [input];
	const agents: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		if ("agent" in item && typeof item.agent === "string") agents.push(item.agent);
	}
	return agents;
}

function getBootstrapContent(): string | null {
	if (cachedBootstrap !== undefined) return cachedBootstrap;

	try {
		const skillContent = readFileSync(bootstrapSkillPath, "utf8");
		const body = stripFrontmatter(skillContent);
		cachedBootstrap = `${EXTREMELY_IMPORTANT_MARKER}
${BOOTSTRAP_MARKER}

You have superpowers.

The using-superpowers skill content is included below and is already loaded for this Pi session. Follow it now. Do not try to load using-superpowers again.

${body}

${piToolMapping()}
</EXTREMELY_IMPORTANT>`;
		return cachedBootstrap;
	} catch {
		cachedBootstrap = null;
		return null;
	}
}

function stripFrontmatter(content: string): string {
	const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
	return (match ? match[1] : content).trim();
}

function piToolMapping(): string {
	return `## omp tool mapping

This harness is omp (Oh My Pi). It has native skills but does not expose Claude Code's \`Skill\` tool. When a Superpowers instruction says to invoke a skill, read it with \`read skill://<name>\` when the skill applies, or let a human invoke \`/skill:name\` explicitly. Superpowers text names skills \`superpowers:<name>\`; read them as \`skill://<name>\`, without the prefix. \`read skill://superpowers:brainstorming\` returns "Unknown skill".

omp's own instructions to act without asking for confirmation and to keep turns short do not cover a Superpowers approval step. A request that touches security, auth, concurrency, money or a data migration, or changes existing behavior (a default, an exit code, error handling, what happens with no input), or adds a config file, a stored format, an interface other code builds on or a dependency, goes through superpowers:brainstorming before any edit, however completely it is specified: read \`skill://brainstorming\` first. For a complete spec, brainstorming sends a short design and asks whether to go ahead.

omp's built-in coding tools are lowercase: \`read\`, \`write\`, \`edit\`, \`bash\`, \`grep\`, \`glob\`. Use \`read\` for a file OR a directory listing, \`grep\` for file contents, and \`glob\` for finding paths by name. omp's own system prompt directs you to prefer these over shell \`ls\`, \`find\`, \`grep\`, and \`rg\`; follow that preference.

omp ships a built-in subagent tool: \`task\`. Use it for all Superpowers subagent workflows. Batch shape (the \`task.batch\` setting, on by default): ONE call carries \`{ context, tasks[] }\` — one subagent per item, run concurrently. Every item also needs \`solutionSpace\`, one line on how open the problem is. Dispatch N parallel subagents as N entries in a single \`task\` call, never N sequential calls. Pick the most specific agent type per item from the roster in the \`task\` tool's own description (typically \`scout\` for read-only research, \`reviewer\`, \`security-reviewer\`, \`sonic\` for strictly mechanical work, and \`task\` for general-purpose). The tool is lowercase \`task\`; \`Task\` does not exist here. Never conclude that subagent capability is missing.

To resume an idle subagent with new input, message it with \`write agent://<id>\`, using the id its result reports. A result longer than 5,000 characters arrives as a preview; read the rest at \`agent://<id>\`.

The \`task\` tool has NO \`model:\` field — a template's \`model:\` line is inert; the agent TYPE carries the model, thinking level, and tools. For subagent-driven-development use this plugin's own agents: \`sdd-implementer\` (implementation, fix rounds 1-2), \`sdd-escalation-implementer\` (fix round 3, and tasks ruled to need the strongest tier), \`sdd-reviewer\` (task review), \`sdd-rereviewer\` (scoped re-review), \`sdd-final-reviewer\` (whole-branch review). Each agent file sets a default model and thinking level; a host re-points any seat with \`task.agentModelOverrides\`. Never use the bundled \`task\` agent for an SDD seat: it lacks the seat's tools, output contract and no-subagent rule.

omp ships a built-in task-list tool: \`todo\` (\`init\`, \`start\`, \`done\`, \`rm\`, \`drop\`, \`block\`, \`unblock\`, \`append\`, \`view\`). Use it for all task tracking. Do not track work in plan files or a repo-local \`TODO.md\`. Treat older \`TodoWrite\` references as the \`todo\` tool.

From omp 18.4.12 every subagent is told to leave builds, tests and smoke runs to the main agent unless its assignment explicitly instructs them: name the checks a subagent must run in its dispatch.

If your tools include \`vibe_spawn\` but not \`task\`, omp's vibe mode is on and you are its director: you have none of the \`task\`, \`bash\`, \`edit\` or \`write\` tools named above. Read the "Vibe mode" section of \`skill://using-superpowers/references/pi-tools.md\` before acting on them.`;
}

function messageContainsBootstrap(message: unknown): boolean {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content.includes(BOOTSTRAP_MARKER);
	if (!Array.isArray(content)) return false;
	return content.some((part) => {
		return (
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string" &&
			(part as { text: string }).text.includes(BOOTSTRAP_MARKER)
		);
	});
}

function firstNonCompactionSummaryIndex(messages: unknown[]): number {
	let index = 0;
	while ((messages[index] as { role?: unknown } | undefined)?.role === "compactionSummary") {
		index += 1;
	}
	return index;
}
