# agent-skills

Reusable agent skills for development and automation.

## Status and installation

Initial implementation awaiting review. Skills live at `skills/<skill-name>/SKILL.md`.

After the initial pull request is merged, run from your project:

```sh
npx skills add yapr/agent-skills --skill build-in-public -a codex
```

This command is a post-merge example, not a verified remote installation. Review the skill before installing. The [official CLI](https://github.com/vercel-labs/skills) installs into the current project by default; do not add `-g` unless you intend a global installation.

For a local checkout, use `npx skills@1.7.4 add /absolute/path/to/agent-skills --skill build-in-public -a codex -y` in a disposable project. Installation verification covers Codex project files only; it does not establish agent runtime behavior or Claude Code compatibility.

## Available skill

| Skill | Purpose |
| --- | --- |
| [build-in-public](skills/build-in-public/SKILL.md) | Turn approved development evidence into a factual, privacy-conscious draft for review. Never publishes. |

## Usage and contribution

Ask your agent to use `build-in-public` with an explicit source range and audience. Instructions do not grant access or authorization. Respect repository instructions and the execution environment's permissions.

Propose focused changes through a normal pull request. Include a realistic example, evidence for factual claims, validation results, and limitations. Do not contribute credentials, private URLs, customer details, internal operational code, or copied private material. No automatic publishing or deployment is included.

## License decision

MIT is proposed, not adopted. No LICENSE grant has been made in this initial proposal. The maintainer must approve a license before this is described as freely reusable open-source software. Public visibility alone does not grant reuse rights.
