-- 0012 The language of an account (task 0.8d).
--
-- docs/spec/12-ux-standards.md, Language: each person chooses a language and
-- the choice is remembered. It lives on the account, so that task 0.9 can send
-- notices in the person's language; a browser keeps a choice of its own for the
-- pages before sign-in. A new account is in Uzbek (decided by the owner); the
-- default also fills the rows that exist. The list of the check equals
-- `LANGUAGES` of packages/shared; a test compares the two.
--
-- The table is small and nothing is deployed yet, so one step is enough.
alter table accounts
  add column language text not null default 'uz',
  add constraint accounts_language_check check (language in ('uz', 'ru', 'en'));

-- The person changes their own language; the other rights stay as they are.
grant update (language) on accounts to sodiq_app;
