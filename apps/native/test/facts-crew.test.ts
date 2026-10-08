import test from 'node:test';
import assert from 'node:assert/strict';
import {crewRank, keyCrew} from '../src/screens/title/facts.ts';

const credit = (id: string, name: string, role: string, department: string, personId?: string) => ({id, name, role, department, ...(personId ? {personId} : {})});

// M32 (web parity, WEB-DETAIL-05): crew shelf order is Directing, Writing,
// Screenplay, Creator, Composer, Producer.
test('keyCrew keeps one row per person in credit order, at most 8, and drops other departments', () => {
  const credits = [
    credit('c11', 'Property Pete', 'Property Master', 'Art', 'p11'),
    credit('c6', 'Producer Pam', 'Producer', 'Production', 'p6'),
    credit('c12', 'Editor Ed', 'Editor', 'Editing', 'p12'),
    credit('c1', 'Director Dan', 'Director', 'Directing', 'p1'),
    credit('c4', 'Creator Cat', 'Creator', 'Creator', 'p4'),
    credit('c2', 'Writer Wendy', 'Writer', 'Writing', 'p2'),
    credit('c5', 'Composer Cole', 'Original Music Composer', 'Music', 'p5'),
    credit('c3', 'Screenplay Sam', 'Screenplay', 'Writing', 'p3'),
    credit('c8', 'Second Sean', 'Director', 'Directing', 'p8'),
    credit('c7', 'Exec Erin', 'Executive Producer', 'Production', 'p7'),
    credit('c10', 'Extra Producer', 'Co-Producer', 'Production', 'p10'),
    credit('c1b', 'Director Dan', 'Director', 'Directing', 'p1'),
  ];
  const names = keyCrew(credits).map(c => c.name);
  assert.deepEqual(names, ['Director Dan', 'Second Sean', 'Writer Wendy', 'Screenplay Sam', 'Creator Cat', 'Composer Cole', 'Producer Pam', 'Exec Erin']);
  assert.ok(!names.includes('Property Pete') && !names.includes('Editor Ed'), 'property masters and editors are crew, not key crew');
  assert.equal(crewRank('Art', 'Property Master'), -1);
  assert.equal(crewRank('Directing', 'Director'), 0);
  assert.equal(crewRank('Writing', 'Screenplay'), 1);
  assert.equal(crewRank('Writing', 'Writer'), 1);
  assert.equal(crewRank('Creator', 'Creator'), 3);
  assert.equal(crewRank('Music', 'Original Music Composer'), 4);
  assert.equal(crewRank('Production', 'Executive Producer'), 5);
});
