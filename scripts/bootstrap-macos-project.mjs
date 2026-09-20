#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const backlog = JSON.parse(
  readFileSync(resolve(root, 'engineering', 'macos-m4', 'backlog.json'), 'utf8'),
);

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const repository = arg('--repo', 'TheerasakPing/dwb-mcp-studio-public');
const [owner, repoName] = repository.split('/');
if (!owner || !repoName) throw new Error('Use --repo OWNER/REPO');

function gh(args, { json = false, quiet = false } = {}) {
  try {
    const output = execFileSync('gh', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    }).trim();
    return json && output ? JSON.parse(output) : output;
  } catch (error) {
    const stderr = String(error.stderr || '').trim();
    const stdout = String(error.stdout || '').trim();
    const details = stderr || stdout || error.message;
    throw new Error(`gh ${args.join(' ')} failed: ${details}`);
  }
}

function ensureGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'GitHub CLI (gh) is required. Install it, run gh auth login, then grant project scope with: gh auth refresh -s project',
    );
  }
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  } catch {
    throw new Error('GitHub CLI is not authenticated. Run: gh auth login');
  }
}

function arrayOf(value, key) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.[key]) ? value[key] : [];
}

function projectList() {
  return arrayOf(
    gh(['project', 'list', '--owner', owner, '--limit', '100', '--format', 'json'], {
      json: true,
      quiet: true,
    }),
    'projects',
  );
}

function ensureProject() {
  let project = projectList().find((item) => item.title === backlog.project.title);
  if (!project) {
    project = gh(
      [
        'project',
        'create',
        '--owner',
        owner,
        '--title',
        backlog.project.title,
        '--format',
        'json',
      ],
      { json: true, quiet: true },
    );
  }

  const number = String(project.number);
  try {
    gh(['project', 'link', number, '--owner', owner, '--repo', repoName], { quiet: true });
  } catch (error) {
    if (!/already|linked/i.test(error.message)) throw error;
  }

  gh(
    [
      'project',
      'edit',
      number,
      '--owner',
      owner,
      '--description',
      backlog.project.description,
      '--readme',
      [
        '# DWB MCP Studio — macOS M4 Port',
        '',
        'Backlog source: `engineering/macos-m4/backlog.json`',
        '',
        'Detailed plan: `docs/MACOS-M4-PROJECT-PLAN.md`',
        '',
        'Rule: keep Windows beta.14 behavior stable while extracting platform-specific layers.',
      ].join('\n'),
      '--visibility',
      'PUBLIC',
    ],
    { quiet: true },
  );

  return gh(['project', 'view', number, '--owner', owner, '--format', 'json'], {
    json: true,
    quiet: true,
  });
}

const fieldDefinitions = [
  ['Work Status', ['Backlog', 'Ready', 'In progress', 'Review', 'Validation', 'Done']],
  ['Priority', ['P0', 'P1', 'P2', 'P3']],
  ['Phase', ['0', '1', '2', '3', '4', '5', '6']],
  [
    'Area',
    ['Core', 'Runtime', 'Installer', 'Tunnel', 'Security', 'UI', 'CI', 'Validation', 'Release', 'Docs'],
  ],
  ['Platform', ['Cross-platform', 'macOS', 'Windows']],
  ['Risk', ['Low', 'Medium', 'High']],
  ['Target', [backlog.project.target]],
];

function fieldList(projectNumber) {
  return arrayOf(
    gh(
      ['project', 'field-list', String(projectNumber), '--owner', owner, '--limit', '100', '--format', 'json'],
      { json: true, quiet: true },
    ),
    'fields',
  );
}

function ensureFields(projectNumber) {
  let fields = fieldList(projectNumber);
  for (const [name, options] of fieldDefinitions) {
    if (fields.some((field) => field.name === name)) continue;
    gh(
      [
        'project',
        'field-create',
        String(projectNumber),
        '--owner',
        owner,
        '--name',
        name,
        '--data-type',
        'SINGLE_SELECT',
        '--single-select-options',
        options.join(','),
      ],
      { quiet: true },
    );
    fields = fieldList(projectNumber);
  }
  return fields;
}

function itemList(projectNumber) {
  return arrayOf(
    gh(
      ['project', 'item-list', String(projectNumber), '--owner', owner, '--limit', '200', '--format', 'json'],
      { json: true, quiet: true },
    ),
    'items',
  );
}

function bodyOf(item) {
  const dependencies = item.depends_on.length ? item.depends_on.map((x) => `- ${x}`).join('\n') : '- None';
  const checks = item.checks.map((x) => `- [ ] ${x}`).join('\n');
  return [
    `## Goal\n${item.summary}`,
    '',
    '## Metadata',
    `- ID: ${item.id}`,
    `- Phase: ${item.phase}`,
    `- Priority: ${item.priority}`,
    `- Area: ${item.area}`,
    `- Platform: ${item.platform}`,
    `- Risk: ${item.risk}`,
    `- Target: ${backlog.project.target}`,
    '',
    '## Dependencies',
    dependencies,
    '',
    '## Checklist',
    checks,
    '',
    '## Definition of Done',
    '- Checklist completed',
    '- Tests relevant to the change pass',
    '- Windows beta.14 behavior is not regressed unless explicitly documented',
    '- Documentation/validation evidence is updated when applicable',
  ].join('\n');
}

function createOrFindItem(projectNumber, spec, existingItems) {
  const title = `[${spec.id}] ${spec.title}`;
  let item = existingItems.find((candidate) => candidate.title === title);
  if (!item) {
    item = gh(
      [
        'project',
        'item-create',
        String(projectNumber),
        '--owner',
        owner,
        '--title',
        title,
        '--body',
        bodyOf(spec),
        '--format',
        'json',
      ],
      { json: true, quiet: true },
    );
    existingItems.push(item);
  }
  return item;
}

function selectOption(fields, fieldName, optionName) {
  const field = fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`Project field not found: ${fieldName}`);
  const option = (field.options || []).find((candidate) => candidate.name === optionName);
  if (!option) throw new Error(`Project option not found: ${fieldName}=${optionName}`);
  return { field, option };
}

function setSelect(project, projectNumber, fields, item, fieldName, optionName) {
  const { field, option } = selectOption(fields, fieldName, optionName);
  gh(
    [
      'project',
      'item-edit',
      '--id',
      item.id,
      '--field-id',
      field.id,
      '--project-id',
      project.id,
      '--single-select-option-id',
      option.id,
    ],
    { quiet: true },
  );
}

function main() {
  ensureGh();
  const project = ensureProject();
  const projectNumber = project.number;
  const fields = ensureFields(projectNumber);
  const existingItems = itemList(projectNumber);
  let createdOrUpdated = 0;

  for (const spec of backlog.items) {
    const item = createOrFindItem(projectNumber, spec, existingItems);
    setSelect(project, projectNumber, fields, item, 'Work Status', 'Backlog');
    setSelect(project, projectNumber, fields, item, 'Priority', spec.priority);
    setSelect(project, projectNumber, fields, item, 'Phase', spec.phase);
    setSelect(project, projectNumber, fields, item, 'Area', spec.area);
    setSelect(project, projectNumber, fields, item, 'Platform', spec.platform);
    setSelect(project, projectNumber, fields, item, 'Risk', spec.risk);
    setSelect(project, projectNumber, fields, item, 'Target', backlog.project.target);
    createdOrUpdated += 1;
    process.stdout.write(`✓ ${spec.id} ${spec.title}\n`);
  }

  process.stdout.write(
    `\nProject ready: ${project.url || `https://github.com/users/${owner}/projects/${projectNumber}`}\n` +
      `Items synchronized: ${createdOrUpdated}\n`,
  );
}

try {
  main();
} catch (error) {
  console.error('\nDWB macOS project bootstrap failed:');
  console.error(error.message);
  if (/scope|project/i.test(error.message)) {
    console.error('\nEnsure the GitHub CLI token has Projects scope: gh auth refresh -s project');
  }
  process.exitCode = 1;
}
