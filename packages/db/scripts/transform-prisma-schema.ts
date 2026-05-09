/**
 * Post-introspection transform for prisma/schema.prisma.
 *
 * Prisma introspect doesn't know our columns are db-provided:
 *   - id, seq, createdBy, createdAt: → add @default(dbgenerated())
 *
 * Usage: npx tsx scripts/transform-prisma-schema.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const schemaPath = resolve(import.meta.dirname, '../prisma/schema.prisma');
let schema = readFileSync(schemaPath, 'utf-8');

// id: add @default(dbgenerated()) if not already present (e.g. ChangeLog)
schema = schema.replace(
  /^(\s+id\s+String\s+)@id(?!\s+@default)$/gm,
  '$1@id @default(dbgenerated())',
);

// seq, createdBy, createdAt: add @default(dbgenerated()) if not already present
schema = schema.replace(
  /^(\s+(?:seq|createdBy|createdAt)\s+String)((?:(?!@default).)*?)$/gm,
  '$1$2 @default(dbgenerated())',
);

// ChangeLog: old and new are JSON columns
schema = schema.replace(/^(model ChangeLog \{[\s\S]*?)(^\})/gm, (block) =>
  block.replace(/^(\s+(?:old|new)\s+)String(\s)/gm, '$1Json$2'),
);

// Rename auto-generated relation fields to semantic names
const renames: [RegExp, string][] = [
  // Note: NoteNote[] relations
  [/noteNoteNoteNoteParentIdTonote/g, 'children'],
  [/noteNoteNoteNoteNoteIdTonote/g, 'parents'],
  // NoteNote: Note relations
  [/noteNoteNoteParentIdTonote/g, 'parent'],
  [/noteNoteNoteNoteIdTonote/g, 'note'],
  // NoteUser: User relations
  [/userNoteUserCreatedByTouser/g, 'creator'],
  [/userNoteUserUserIdTouser/g, 'user'],
  // User: NoteUser[] relations
  [/noteUserNoteUserCreatedByTouser/g, 'createdNoteUsers'],
  [/noteUserNoteUserUserIdTouser/g, 'noteUser'],
  // User: self-reference
  [/^(\s+)user(\s+User\s+@relation\("userTouser")/gm, '$1creator$2'],
  [
    /^(\s+)otherUser(\s+User\[\]\s+@relation\("userTouser"\))/gm,
    '$1createdUsers$2',
  ],
];

for (const [pattern, replacement] of renames) {
  schema = schema.replace(pattern, replacement);
}

// ChangeLog: add virtual relations via rowId to all tracked models.
// These have no FK in SQLite but work because UUIDs are globally unique.
const changeLogModels = [
  'File',
  'Note',
  'NoteNote',
  'NoteReaction',
  'NoteTag',
  'NoteUser',
  'Reaction',
  'Role',
  'Tag',
  'User',
];

// Disambiguate ChangeLog's existing createdBy -> User relation
schema = schema.replace(/^(model ChangeLog \{[\s\S]*?)(^\})/gm, (block) =>
  block.replace(
    /^(\s+user\s+User\s+@relation\()(?!"change_log_created_byTouser")(fields:\s*\[createdBy\])/gm,
    '$1"change_log_created_byTouser", $2',
  ),
);

// Disambiguate User's existing changeLog[] (createdBy) relation
schema = schema.replace(/^(model User \{[\s\S]*?)(^\})/gm, (block) =>
  block.replace(
    /^(\s+changeLog\s+ChangeLog\[\])\s*$/gm,
    '$1    @relation("change_log_created_byTouser")',
  ),
);

// Add rowId relations to ChangeLog model (before @@map)
const changeLogRelLines = changeLogModels.map((model) => {
  const field = model.charAt(0).toLowerCase() + model.slice(1) + 'Row';
  if (model === 'User') {
    return `  ${field}   ${model}?  @relation("change_log_row_idTouser", fields: [rowId], references: [id], onDelete: NoAction, onUpdate: NoAction)`;
  }
  return `  ${field}   ${model}?  @relation(fields: [rowId], references: [id], onDelete: NoAction, onUpdate: NoAction)`;
});

schema = schema.replace(
  /^(model ChangeLog \{[\s\S]*?)(^\s*@@map\("change_log"\))/gm,
  (_, body, mapLine) => {
    if (body.includes('noteRow')) return body + mapLine;
    return body + changeLogRelLines.join('\n') + '\n' + mapLine;
  },
);

// Add reverse changeLogRows relation on each tracked model (before first @@)
for (const model of changeLogModels) {
  const fieldName = model === 'User' ? 'changeLogRows' : 'changeLog';
  const relAttr =
    model === 'User' ? '    @relation("change_log_row_idTouser")' : '';
  const reverseField = `  ${fieldName}    ChangeLog[]${relAttr}`;
  const re = new RegExp(`^(model ${model} \\{[\\s\\S]*?)(^\\s*@@)`, 'gm');
  schema = schema.replace(re, (_, body, firstAtAt) => {
    if (body.includes(fieldName + ' ')) return body + firstAtAt;
    return body + reverseField + '\n' + firstAtAt;
  });
}

writeFileSync(schemaPath, schema);
console.log('Transformed prisma/schema.prisma');
