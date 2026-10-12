import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LogMailer, RecordingMailer } from './mailer.js';

const MAIL = {
  to: 'invented.person@example.uz',
  subject: 'Choose a new password',
  text: 'Choose the new password with this link: http://localhost:5173/reset-password#token=x',
};

// Task 2.3c-2, pull request #66; the owner's answer 16: "until go-live
// (task 10.4) emails are written to the log only, never sent".
describe('the mail service', () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const directory of made.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('writes a mail to the log, and nowhere else without an outbox', async () => {
    const lines: string[] = [];
    await new LogMailer(undefined, { log: (line) => lines.push(line) }).send(MAIL);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`To: ${MAIL.to}`);
    expect(lines[0]).toContain(`Subject: ${MAIL.subject}`);
    expect(lines[0]).toContain(MAIL.text);
  });

  it('also writes each mail as one file into the outbox of the browser tests', async () => {
    const outbox = await mkdtemp(join(tmpdir(), 'sodiq-outbox-'));
    made.push(outbox);
    const mailer = new LogMailer(join(outbox, 'mails'), { log: () => undefined });
    await mailer.send(MAIL);
    await mailer.send({ ...MAIL, subject: 'Second' });

    const files = await readdir(join(outbox, 'mails'));
    expect(files).toHaveLength(2);
    const mails = await Promise.all(
      files.map(
        async (file) => JSON.parse(await readFile(join(outbox, 'mails', file), 'utf8')) as unknown,
      ),
    );
    expect(mails).toContainEqual(MAIL);
  });

  it('records in the tests, and fails when told to', async () => {
    const mailer = new RecordingMailer();
    await mailer.send(MAIL);
    expect(mailer.sent).toEqual([MAIL]);
    mailer.failing = true;
    await expect(mailer.send(MAIL)).rejects.toThrow();
    expect(mailer.sent).toHaveLength(1);
  });
});
