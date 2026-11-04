// Fills the missing daily and quarter distributions of the subjects of the draft's teaching load.
// Paste on app-test.sodiqschool.uz, signed in as the AVP, with the draft open (Teaching load or Draft builder).
(async () => {
  const DAILY = { attendance: 20, classwork: 40, homework: 40 };
  const QUARTER = { attendance: 20, classwork: 40, homework: 40, ratingExam: null };
  const QUARTER_WITH_EXAM = { attendance: 20, classwork: 30, homework: 30, ratingExam: 20 };
  const PRIMARY = { attendance: 20, classwork: 40, homework: 40 };
  const REASON = 'Demo setup of the tutorial branch';
  let branch = null;
  const call = async (method, url, body) => {
    const headers = { 'X-App-Version': '1' };
    if (branch) headers['X-Branch-Id'] = branch;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) throw new Error(r.status + ' ' + text);
    return text ? JSON.parse(text) : null;
  };
  const session = await call('GET', '/api/auth/session');
  const mine = session.branches ?? [];
  const b = mine.find((x) => /istirohat/i.test(x.name)) ?? mine.find((x) => x.id === sessionStorage.getItem('sodiq.branch'));
  if (!b) throw new Error('This account has no branch named Istirohat demo.');
  branch = b.id;

  const versions = (await call('GET', '/api/timetable/versions')).versions;
  const fromUrl = new URLSearchParams(location.search).get('version');
  const version = versions.find((v) => v.id === fromUrl) ?? versions.find((v) => v.status === 'draft');
  if (!version) throw new Error('Open the draft first (its address has ?version=…).');
  const load = await call('GET', '/api/timetable/versions/' + version.id + '/load');
  const used = new Set(load.rows.map((row) => row.subject.id));
  const subjects = (await call('GET', '/api/setup/subjects')).subjects.filter((s) => used.has(s.id) && s.journalType === 'graded');
  const today = new Date().toISOString().slice(0, 10);

  // A save that changes a stored value asks for a reason; its preview says so.
  const save = async (base, body) => {
    const preview = await call('POST', base + '/preview', body);
    await call('PUT', base, preview && preview.reasonRequired ? { ...body, reason: REASON } : body);
  };

  let done = 0;
  const failed = [];
  for (const subject of subjects) {
    const name = subject.names.uz;
    try {
      if (subject.daily === null) {
        await call('PUT', '/api/setup/subjects/' + subject.id + '/daily-weights', DAILY);
        console.log(name + ': daily distribution 20 / 40 / 40');
        done += 1;
      }
      const q = await call('GET', '/api/setup/subjects/' + subject.id + '/quarter-weights?yearId=' + version.academicYearId);
      for (const quarter of q.quarters) {
        if (!quarter.graded || (quarter.endDate !== null && quarter.endDate < today)) continue;
        const base = '/api/setup/subjects/' + subject.id + '/quarter-weights/' + quarter.quarterId;
        if (quarter.weights === null) {
          await save(base, quarter.ratingExam ? QUARTER_WITH_EXAM : QUARTER);
          console.log(name + ': quarter ' + quarter.number + (quarter.ratingExam ? ' 20 / 30 / 30 + exam 20' : ' 20 / 40 / 40'));
          done += 1;
        }
        if (quarter.primaryNeeded && quarter.primary === null) {
          await save(base + '/primary', PRIMARY);
          console.log(name + ': quarter ' + quarter.number + ', grades 0–4 without a rating exam, 20 / 40 / 40');
          done += 1;
        }
      }
    } catch (e) {
      failed.push(name + ': ' + e.message);
      console.warn('Refused for ' + name + ': ' + e.message);
    }
  }
  console.log('Done. ' + done + ' distributions filled for ' + subjects.length + ' graded subjects of the load, ' + failed.length + ' refused. Reload the page.');
  if (failed.length) console.error('Refused:\n- ' + failed.join('\n- '));
})();
