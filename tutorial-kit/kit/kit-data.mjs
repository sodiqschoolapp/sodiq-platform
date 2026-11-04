// The demo branch "Istirohat demo": every value the kit files use. Invented people only.
import fs from 'node:fs';
const here = new URL('.', import.meta.url).pathname;

export const BRANCH = 'Istirohat demo';
export const YEAR = { start: '02.09.2026', end: '25.05.2027', quarters: [['02.09.2026', '31.10.2026'], ['09.11.2026', '26.12.2026'], ['11.01.2027', '20.03.2027'], ['30.03.2027', '25.05.2027']] };

// Subjects: `seed` = already in the school after the demo workflow (school-wide); the rest are created.
export const SUBJECTS = [
  { uz: 'Matematika', ru: 'Математика', en: 'Mathematics', dept: 'STEAM', grades: '0–11', seed: true, group: true },
  { uz: 'Ona tili', ru: 'Родной язык', en: 'Native language', dept: 'National', grades: '0–11', seed: true },
  { uz: 'Rus tili', ru: 'Русский язык', en: 'Russian', dept: 'Foreign languages', grades: '0–11', seed: true },
  { uz: 'Ingliz tili', ru: 'Английский язык', en: 'English', dept: 'Foreign languages', grades: '0–11', seed: true, group: true },
  { uz: 'Tarix', ru: 'История', en: 'History', dept: 'National', grades: '0–11', seed: true },
  { uz: 'Informatika', ru: 'Информатика', en: 'Informatics', dept: 'STEAM', grades: '0–11', seed: true },
  { uz: "Tasviriy san'at", ru: 'Изобразительное искусство', en: 'Art', dept: 'General', grades: '0–11', seed: true },
  { uz: 'Jismoniy tarbiya', ru: 'Физкультура', en: 'Physical education', dept: 'General', grades: '0–11', seed: true, group: true },
  { uz: 'Ona tili va adabiyot', ru: 'Родной язык и литература', en: 'Native language and literature', dept: 'National', grades: '5–11' },
  { uz: 'Oʻzbek tili', ru: 'Узбекский язык', en: 'Uzbek', dept: 'National', grades: '1–11' },
  { uz: 'Arab tili', ru: 'Арабский язык', en: 'Arabic', dept: 'Foreign languages', grades: '1–11', group: true },
  { uz: 'Science', ru: 'Естествознание', en: 'Science', dept: 'Natural sciences', grades: '1–6' },
  { uz: 'Robototexnika', ru: 'Робототехника', en: 'Robotics', dept: 'STEAM', grades: '1–8' },
  { uz: 'PBL', ru: 'Проектное обучение', en: 'Project-based learning', dept: 'STEAM', grades: '1–8' },
  { uz: 'Tarbiya', ru: 'Воспитание', en: 'Upbringing', dept: 'General', grades: '1–11' },
  { uz: 'Oʻqish', ru: 'Чтение', en: 'Reading', dept: 'National', grades: '1–4' },
  { uz: 'Mantiq', ru: 'Логика', en: 'Logic', dept: 'STEAM', grades: '1–4' },
  { uz: 'Mental arifmetika', ru: 'Ментальная арифметика', en: 'Mental arithmetic', dept: 'STEAM', grades: '1–4' },
  { uz: 'AKT', ru: 'ИКТ', en: 'ICT', dept: 'STEAM', grades: '1–4' },
  { uz: 'Kelajak soati', ru: 'Час будущего', en: 'Future hour', dept: 'Tutors', grades: '5–8', note: 'Tutors department: held by the class’s Tutor' },
  { uz: 'Uy vazifasi', ru: 'Домашнее задание', en: 'Homework', dept: 'Tutors', grades: '1–4', note: 'Tutors department: held by the Class teacher' },
  { uz: 'AP Tarix', ru: 'AP История', en: 'AP History', dept: 'National', grades: '10–11' },
  { uz: 'AP Matematika', ru: 'AP Математика', en: 'AP Math', dept: 'STEAM', grades: '10–11' },
  { uz: 'AP Iqtisodiyot', ru: 'AP Экономика', en: 'AP Economics', dept: 'General', grades: '10–11' },
  { uz: 'SAT Matematika', ru: 'SAT Математика', en: 'SAT Math', dept: 'STEAM', grades: '10–11' },
  { uz: 'SAT Ingliz tili', ru: 'SAT Английский', en: 'SAT English', dept: 'Foreign languages', grades: '10–11' },
  { uz: 'IELTS', ru: 'IELTS', en: 'IELTS', dept: 'Foreign languages', grades: '10–11' },
  { uz: 'Speaking', ru: 'Разговорная практика', en: 'Speaking', dept: 'Foreign languages', grades: '10–11' },
  { uz: 'Matematika qoʻshimcha', ru: 'Математика дополнительно', en: 'Extra mathematics', dept: 'STEAM', grades: '10–11' },
  { uz: 'Moliya', ru: 'Финансы', en: 'Finance', dept: 'General', grades: '10–11' },
  { uz: 'Siyosatshunoslik', ru: 'Политология', en: 'Political science', dept: 'General', grades: '10–11' },
  { uz: 'School Counseling', ru: 'Школьное консультирование', en: 'School counselling', dept: 'General', grades: '10–11', note: 'Journal type: Attendance only' },
];


// Staff: invented. dept is the main department (Academic division). role: Teacher, Tutor or ''.
// lang: 'Oʻzbek' or 'Oʻzbek va rus' (teachers of 3 Indigo, a Russian-language class).
const S = (key, last, first, father, sex, dept, role, extra = {}) => ({ key, last, first, father, sex, dept, role, ...extra });
export const STAFF = [
  S('rahimov', 'Rahimov', 'Aziz', 'Botir oʻgʻli', 'm', 'STEAM', 'Teacher'),
  S('qodirov', 'Qodirov', 'Bahodir', 'Ulugʻbek oʻgʻli', 'm', 'STEAM', 'Teacher'),
  S('qurbonov', 'Qurbonov', 'Sherzod', 'Anvar oʻgʻli', 'm', 'STEAM', 'Teacher'),
  S('ergasheva', 'Ergasheva', 'Madina', 'Rustam qizi', 'f', 'Foreign languages', 'Teacher', { note: 'Head Teacher: the Super Admin gives it by hand' }),
  S('rasulova', 'Rasulova', 'Shahnoza', 'Farhod qizi', 'f', 'Foreign languages', 'Teacher'),
  S('aminova', 'Aminova', 'Nigora', 'Shavkat qizi', 'f', 'Foreign languages', 'Teacher'),
  S('hamidova', 'Hamidova', 'Feruza', 'Komil qizi', 'f', 'National', 'Teacher', { both: true }),
  S('sobirovag', 'Sobirova', 'Gulchehra', 'Akbar qizi', 'f', 'National', 'Teacher'),
  S('saidova', 'Saidova', 'Nilufar', 'Jamol qizi', 'f', 'Foreign languages', 'Teacher'),
  S('abdurahmonova', 'Abdurahmonova', 'Hilola', 'Sobir qizi', 'f', 'Foreign languages', 'Teacher'),
  S('nazarova', 'Nazarova', 'Dilfuza', 'Hamza qizi', 'f', 'National', 'Teacher'),
  S('aliyev', 'Aliyev', 'Bekzod', 'Erkin oʻgʻli', 'm', 'Natural sciences', 'Teacher'),
  S('karimovj', 'Karimov', 'Jasur', 'Odil oʻgʻli', 'm', 'STEAM', 'Teacher'),
  S('tursunova', 'Tursunova', 'Gulnora', 'Baxtiyor qizi', 'f', 'Foreign languages', 'Teacher'),
  S('ismoilova', 'Ismoilova', 'Sevara', 'Davron qizi', 'f', 'Foreign languages', 'Teacher'),
  S('karimovam', 'Karimova', 'Malika', 'Zafar qizi', 'f', 'STEAM', 'Teacher', { both: true }),
  S('normatov', 'Normatov', 'Otabek', 'Akmal oʻgʻli', 'm', 'General', 'Teacher', { both: true, note: 'Also a parent: his phone is a student’s father’s phone' }),
  S('sobirova', 'Sobirova', 'Lola', 'Ilhom qizi', 'f', 'STEAM', 'Teacher'),
  S('mirzayeva', 'Mirzayeva', 'Dilnoza', 'Murod qizi', 'f', 'General', 'Teacher'),
  S('xolmatov', 'Xolmatov', 'Sardor', 'Nodir oʻgʻli', 'm', 'General', 'Teacher', { both: true }),
  S('qosimova', 'Qosimova', 'Zarina', 'Alisher qizi', 'f', 'General', 'Teacher', { both: true }),
  S('hasanov', 'Hasanov', 'Rustam', 'Qahramon oʻgʻli', 'm', 'General', 'Teacher'),
  S('tursunboyeva', 'Tursunboyeva', 'Mohira', 'Sanjar qizi', 'f', 'General', 'Teacher'),
  S('ahmedov', 'Ahmedov', 'Javlon', 'Rashid oʻgʻli', 'm', 'STEAM', 'Teacher'),
  S('rahmonov', 'Rahmonov', 'Timur', 'Valijon oʻgʻli', 'm', 'National', 'Teacher'),
  S('usmonov', 'Usmonov', 'Alisher', 'Bahrom oʻgʻli', 'm', 'National', 'Teacher'),
  S('jorayev', 'Joʻrayev', 'Shohruh', 'Mansur oʻgʻli', 'm', 'National', 'Teacher'),
  S('tojiyev', 'Tojiyev', 'Kamron', 'Ravshan oʻgʻli', 'm', 'Foreign languages', 'Teacher'),
  S('olimov', 'Olimov', 'Jamshid', 'Tohir oʻgʻli', 'm', 'General', 'Teacher'),
  S('fozilov', 'Fozilov', 'Diyorbek', 'Shuhrat oʻgʻli', 'm', 'Foreign languages', 'Teacher'),
  S('rahimberdiyev', 'Rahimberdiyev', 'Asadbek', 'Ulmas oʻgʻli', 'm', 'STEAM', 'Teacher'),
  S('haydarova', 'Haydarova', 'Gulnoza', 'Yusuf qizi', 'f', 'STEAM', 'Teacher'),
  S('xolmirzayev', 'Xolmirzayev', 'Nodir', 'Jasur oʻgʻli', 'm', 'General', 'Teacher'),
  S('raximova', 'Raximova', 'Laylo', 'Sherali qizi', 'f', 'Foreign languages', 'Teacher'),
  S('sharipov', 'Sharipov', 'Ilhom', 'Zokir oʻgʻli', 'm', 'General', 'Teacher'),
  S('alimov', 'Alimov', 'Bobur', 'Abdulla oʻgʻli', 'm', 'General', 'Teacher'),
  S('ahmadova', 'Ahmadova', 'Dildora', 'Islom qizi', 'f', 'Foreign languages', 'Teacher', { both: true }),
  S('holiqova', 'Holiqova', 'Sabina', 'Rauf qizi', 'f', 'Foreign languages', 'Teacher', { both: true }),
  S('rustamova', 'Rustamova', 'Nargiza', 'Ergash qizi', 'f', 'Foreign languages', 'Teacher', { both: true }),
  S('sultonov', 'Sultonov', 'Anvar', 'Hamid oʻgʻli', 'm', 'Foreign languages', 'Teacher', { both: true }),
  S('ortiqova', 'Ortiqova', 'Mohinur', 'Aziz qizi', 'f', 'STEAM', 'Teacher', { both: true }),
  S('bakirova', 'Bakirova', 'Iroda', 'Lutfulla qizi', 'f', 'STEAM', 'Teacher', { both: true }),
  S('ismatov', 'Ismatov', 'Farrux', 'Doniyor oʻgʻli', 'm', 'Natural sciences', 'Teacher', { both: true }),
  S('tolipov', 'Toʻlipov', 'Jahongir', 'Shermat oʻgʻli', 'm', 'STEAM', 'Teacher', { both: true }),
  S('nurmatova', 'Nurmatova', 'Kamola', 'Habib qizi', 'f', 'National', 'Teacher', { note: 'Class teacher of 3 Genius: the Super Admin gives that role by hand' }),
  S('ibragimova', 'Ibragimova', 'Ozoda', 'Salim qizi', 'f', 'National', 'Teacher', { both: true, note: 'Class teacher of 3 Indigo: by hand' }),
  // Tutors of grades 5–11 (role Tutor, no subjects).
  S('rashidova', 'Rashidova', 'Umida', 'Abror qizi', 'f', 'Tutors', 'Tutor', { tutorOf: '5 Melbourne' }),
  S('komilov', 'Komilov', 'Sanjar', 'Ikrom oʻgʻli', 'm', 'Tutors', 'Tutor', { tutorOf: '5 Tokyo' }),
  S('xasanova', 'Xasanova', 'Barno', 'Toʻlqin qizi', 'f', 'Tutors', 'Tutor', { tutorOf: '5 London' }),
  S('musayev', 'Musayev', 'Oybek', 'Fayzulla oʻgʻli', 'm', 'Tutors', 'Tutor', { tutorOf: '6 Imperial' }),
  S('hakimov', 'Hakimov', 'Elyor', 'Gʻayrat oʻgʻli', 'm', 'Tutors', 'Tutor', { tutorOf: '11 Princeton' }),
  S('qobilova', 'Qobilova', 'Munisa', 'Bekzod qizi', 'f', 'Tutors', 'Tutor', { tutorOf: '11 Yale' }),
];
// Phones: +998 97 1xx xx xx, far from the demo seed's +998 99 000 xx xx.
STAFF.forEach((s, i) => {
  s.phone = `+99897${String(1100000 + i * 137).padStart(7, '0')}`;
  s.birth = `${String(3 + ((i * 7) % 25)).padStart(2, '0')}.${String(1 + ((i * 5) % 12)).padStart(2, '0')}.${1975 + ((i * 3) % 22)}`;
  s.admission = '15.08.2026';
  s.education = i % 5 === 0 ? 'Magistr' : 'Bakalavr';
});
export const staffByKey = Object.fromEntries(STAFF.map((s) => [s.key, s]));
export const fullName = (s) => `${s.last} ${s.first}`;

// Office staff created by hand (the import gives only Teacher and Tutor).
export const OFFICE = [
  ['Principal', 'Yoʻldoshev Rustam', 'Management'],
  ['Academic Vice Principal', 'Fayzullayeva Nodira', 'Management'],
  ['Vice Principal for Spiritual and Moral Education', 'Valiyeva Shoira', 'Management'],
  ['Head Tutor', 'Tojiboyev Ulugʻbek', 'Academic · Tutors'],
];

export const CLASSES = [
  { name: '3 Genius', grade: 3, label: 'Genius', room: '105', lang: 'Oʻzbek', teacher: 'nurmatova', role: 'Class teacher' },
  { name: '3 Indigo', grade: 3, label: 'Indigo', room: '212', lang: 'Rus', teacher: 'ibragimova', role: 'Class teacher' },
  { name: '5 Melbourne', grade: 5, label: 'Melbourne', room: '208', lang: 'Oʻzbek', teacher: 'rashidova', role: 'Tutor' },
  { name: '5 Tokyo', grade: 5, label: 'Tokyo', room: '209', lang: 'Oʻzbek', teacher: 'komilov', role: 'Tutor' },
  { name: '5 London', grade: 5, label: 'London', room: '204', lang: 'Oʻzbek', teacher: 'xasanova', role: 'Tutor' },
  { name: '6 Imperial', grade: 6, label: 'Imperial', room: '207', lang: 'Oʻzbek', teacher: 'musayev', role: 'Tutor' },
  { name: '11 Princeton', grade: 11, label: 'Princeton', room: '407', lang: 'Oʻzbek', teacher: 'hakimov', role: 'Tutor' },
  { name: '11 Yale', grade: 11, label: 'Yale', room: '408', lang: 'Oʻzbek', teacher: 'qobilova', role: 'Tutor' },
];

export const ROOMS = [
  ['105', '1', 'Classroom', 30, '', 'Home room of 3 Genius; Girls’ PE of grade 3'],
  ['102', '1', 'Classroom', 30, '', 'English group 3-3; Arab tili group 2 of grade 3'],
  ['212', '2', 'Classroom', 30, '', 'Home room of 3 Indigo; Boys’ PE of grade 3'],
  ['204', '2', 'Classroom', 30, '', 'Home room of 5 London; Matematika and English group C'],
  ['207', '2', 'Classroom', 30, '', 'Home room of 6 Imperial'],
  ['208', '2', 'Classroom', 30, '', 'Home room of 5 Melbourne; group A'],
  ['209', '2', 'Classroom', 30, '', 'Home room of 5 Tokyo; group B'],
  ['407', '4', 'Classroom', 30, '', 'Home room of 11 Princeton; Moliya 11AB (both classes: a capacity warning shows)'],
  ['408', '4', 'Classroom', 30, '', 'Home room of 11 Yale'],
  ['Sport zal 1', '1', 'Sports hall', 60, '2', 'PE 11A+11B (both groups at once)'],
  ['Sport zal 2', '1', 'Sports hall', 60, '2', 'PE 5A+5B and 5D+6D (both groups at once)'],
  ['Oshxona', '1', 'Hall', 200, '', 'Canteen: lunch is a break, no lesson uses it'],
];

// Groups. members: a function of the student list. teacherKey / room per group.
export const GROUPS = [
  { name: 'Matematika 5A', subj: 'Matematika', classes: ['5 Melbourne', '5 Tokyo', '5 London'], teacher: 'rahimov', room: '208', kind: 'Group across classes' },
  { name: 'Matematika 5B', subj: 'Matematika', classes: ['5 Melbourne', '5 Tokyo', '5 London'], teacher: 'qodirov', room: '209', kind: 'Group across classes' },
  { name: 'Matematika 5C', subj: 'Matematika', classes: ['5 Melbourne', '5 Tokyo', '5 London'], teacher: 'qurbonov', room: '204', kind: 'Group across classes' },
  { name: 'Ingliz 5A', subj: 'Ingliz tili', classes: ['5 Melbourne', '5 Tokyo', '5 London'], teacher: 'ergasheva', room: '208', kind: 'Group across classes' },
  { name: 'Ingliz 5B', subj: 'Ingliz tili', classes: ['5 Melbourne', '5 Tokyo', '5 London'], teacher: 'rasulova', room: '209', kind: 'Group across classes' },
  { name: 'Ingliz 5C', subj: 'Ingliz tili', classes: ['5 Melbourne', '5 Tokyo', '5 London'], teacher: 'aminova', room: '204', kind: 'Group across classes' },
  { name: 'Jismoniy 5AB Bolalar', subj: 'Jismoniy tarbiya', classes: ['5 Melbourne', '5 Tokyo'], teacher: 'xolmatov', room: 'Sport zal 2', sex: 'm', kind: 'Group across classes' },
  { name: 'Jismoniy 5AB Qizlar', subj: 'Jismoniy tarbiya', classes: ['5 Melbourne', '5 Tokyo'], teacher: 'qosimova', room: 'Sport zal 2', sex: 'f', kind: 'Group across classes' },
  { name: 'Jismoniy 5D6D Bolalar', subj: 'Jismoniy tarbiya', classes: ['5 London', '6 Imperial'], teacher: 'xolmatov', room: 'Sport zal 2', sex: 'm', kind: 'Group across classes, two grades' },
  { name: 'Jismoniy 5D6D Qizlar', subj: 'Jismoniy tarbiya', classes: ['5 London', '6 Imperial'], teacher: 'qosimova', room: 'Sport zal 2', sex: 'f', kind: 'Group across classes, two grades' },
  { name: 'Ingliz 3-1', subj: 'Ingliz tili', classes: ['3 Genius', '3 Indigo'], teacher: 'ahmadova', room: '105', kind: 'Group across classes (Uzbek and Russian classes mixed)' },
  { name: 'Ingliz 3-2', subj: 'Ingliz tili', classes: ['3 Genius', '3 Indigo'], teacher: 'holiqova', room: '212', kind: 'Group across classes (Uzbek and Russian classes mixed)' },
  { name: 'Ingliz 3-3', subj: 'Ingliz tili', classes: ['3 Genius', '3 Indigo'], teacher: 'rustamova', room: '102', kind: 'Group across classes (Uzbek and Russian classes mixed)' },
  { name: 'Jismoniy 3 Bolalar', subj: 'Jismoniy tarbiya', classes: ['3 Genius', '3 Indigo'], teacher: 'xolmatov', room: '212', sex: 'm', kind: 'Group across classes' },
  { name: 'Jismoniy 3 Qizlar', subj: 'Jismoniy tarbiya', classes: ['3 Genius', '3 Indigo'], teacher: 'qosimova', room: '105', sex: 'f', kind: 'Group across classes' },
  { name: 'Arab 3 Genius 1', subj: 'Arab tili', classes: ['3 Genius'], teacher: 'sultonov', room: '105', kind: 'Split of a class' },
  { name: 'Arab 3 Genius 2', subj: 'Arab tili', classes: ['3 Genius'], teacher: 'VACANCY:Arab tili', room: '102', kind: 'Split of a class' },
  { name: 'Arab 3 Indigo 1', subj: 'Arab tili', classes: ['3 Indigo'], teacher: 'sultonov', room: '212', kind: 'Split of a class' },
  { name: 'Arab 3 Indigo 2', subj: 'Arab tili', classes: ['3 Indigo'], teacher: 'VACANCY:Arab tili', room: '102', kind: 'Split of a class' },
  { name: 'Jismoniy 11AB Bolalar', subj: 'Jismoniy tarbiya', classes: ['11 Princeton', '11 Yale'], teacher: 'hasanov', room: 'Sport zal 1', sex: 'm', kind: 'Group across classes' },
  { name: 'Jismoniy 11AB Qizlar', subj: 'Jismoniy tarbiya', classes: ['11 Princeton', '11 Yale'], teacher: 'tursunboyeva', room: 'Sport zal 1', sex: 'f', kind: 'Group across classes' },
  { name: 'Moliya 11AB', subj: 'Moliya', classes: ['11 Princeton', '11 Yale'], teacher: 'olimov', room: '407', kind: 'Group across classes, one group with everyone' },
];
export const VACANCIES = [
  { name: 'Arab tili oʻqituvchisi', dept: 'Foreign languages', subjects: 'Arab tili', where: 'Arab 3 Genius 2, Arab 3 Indigo 2' },
  { name: 'AP Iqtisodiyot oʻqituvchisi', dept: 'General', subjects: 'AP Iqtisodiyot', where: '11 Princeton' },
];

const COL = ['09:00', '09:55', '10:50', '11:45', '12:40', '13:35', '14:30', '15:25'];
const END = ['09:40', '10:35', '11:30', '12:25', '13:20', '14:15', '15:10', '16:05'];
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr'];
export const DAY_NAMES = { Mo: 'Monday', Tu: 'Tuesday', We: 'Wednesday', Th: 'Thursday', Fr: 'Friday' };

// Every lesson of the eight classes (invented teachers), derived once from the school's sheets.
export function lessons() {
  return JSON.parse(fs.readFileSync(here + 'lessons.json', 'utf8'));
}
export { COL, END, DAYS };

// Students: invented. 16 per class, half boys; props added by `buildStudents`.
const BOYS = ['Abdulloh', 'Ahmad', 'Akbar', 'Alisher', 'Asadbek', 'Bekzod', 'Bobur', 'Diyorbek', 'Doniyor', 'Elbek', 'Farrux', 'Hasan', 'Husan', 'Ibrohim', 'Islom', 'Javohir', 'Jahongir', 'Kamron', 'Mirjalol', 'Muhammadali', 'Nodirbek', 'Otabek', 'Ozodbek', 'Rayyon', 'Sardorbek', 'Shohjahon', 'Temur', 'Umar', 'Xondamir', 'Yahyo', 'Zafar', 'Sanjarbek'];
const GIRLS = ['Asal', 'Aziza', 'Dilnura', 'Durdona', 'Gulnoza', 'Hadicha', 'Iroda', 'Kamila', 'Laylo', 'Madina', 'Malika', 'Marjona', 'Mubina', 'Muslima', 'Nilufar', 'Odina', 'Oysha', 'Robiya', 'Ruxshona', 'Sabina', 'Sevinch', 'Shahzoda', 'Soliha', 'Shirin', 'Yasmina', 'Zarina', 'Zilola', 'Zuhra', 'Charos', 'Feruza', 'Hilola', 'Mohinur'];
const STEMS = ['Abdullayev', 'Aliyev', 'Azimov', 'Bahromov', 'Boboyev', 'Davronov', 'Ergashev', 'Fayziyev', 'Gʻaniyev', 'Hamroyev', 'Ismoilov', 'Jalolov', 'Karimov', 'Latipov', 'Mahkamov', 'Nazarov', 'Ortiqov', 'Poʻlatov', 'Qahhorov', 'Rahmatov', 'Saidov', 'Toshpoʻlatov', 'Umarov', 'Valiyev', 'Xoliqov', 'Yoqubov', 'Zaripov', 'Shodiyev', 'Tursunov', 'Murodov', 'Nosirov', 'Sobirov', 'Oripov', 'Haydarov', 'Qurbonov', 'Eshonqulov'];
const FATHERS = ['Akmal', 'Bahodir', 'Dilshod', 'Erkin', 'Farhod', 'Gʻayrat', 'Ilhom', 'Jamshid', 'Komil', 'Murod', 'Nodir', 'Rustam', 'Sherzod', 'Ulugʻbek', 'Zafar', 'Laziz'];
const MOTHERS = ['Dilnoza', 'Gulnora', 'Malika', 'Nargiza', 'Shahlo', 'Mohira', 'Feruza', 'Zulfiya', 'Nodira', 'Umida', 'Sevara', 'Lobar', 'Barno', 'Hulkar', 'Kamola', 'Dildora'];
const birthYear = (grade) => 2026 - 6 - grade - 1 + 1; // grade 3 → 2017, 5 → 2015, 11 → 2009

export function buildStudents() {
  const out = [];
  let n = 0;
  let k = 0;
  for (const c of CLASSES) {
    for (let i = 0; i < 16; i += 1) {
      n += 1;
      const male = i % 2 === 0;
      const stem = STEMS[(n * 7 + i) % STEMS.length];
      const first = male ? BOYS[(n * 5 + i) % BOYS.length] : GIRLS[(n * 3 + i) % GIRLS.length];
      const last = male ? stem : `${stem}a`;
      const fatherFirst = FATHERS[(n + i) % FATHERS.length];
      const motherFirst = MOTHERS[(n * 3) % MOTHERS.length];
      const y = birthYear(c.grade) - (i % 4 === 3 ? 1 : 0);
      const birth = `${String(1 + ((n * 11) % 28)).padStart(2, '0')}.${String(1 + ((n * 7) % 12)).padStart(2, '0')}.${y}`;
      k += 1;
      out.push({
        uid: `IS26${String(n).padStart(3, '0')}`,
        last, first, father: `${fatherFirst} ${male ? 'oʻgʻli' : 'qizi'}`, sex: male ? 'm' : 'f', birth,
        grade: c.grade, className: c.label, cls: c.name, startsOn: YEAR.start,
        contract: `IST-2026/${String(n).padStart(3, '0')}`, contractOn: '20.08.2026',
        consent: i === 5 ? '' : '22.08.2026',
        diagnostic: c.grade >= 5 ? 45 + ((n * 13) % 55) : '',
        scholarship: i === 7 ? { type: 'Merit', coverage: 'Full' } : i === 9 ? { type: 'Financial aid', coverage: 'Partial', amount: 1500000 } : null,
        region: 'Tashkent city', address: `Toshkent, Mirzo Ulugʻbek tumani, ${10 + (n % 40)}-uy`,
        relatives: [
          { name: `${stem}a ${motherFirst} ${FATHERS[(n * 5) % FATHERS.length]} qizi`, rel: 'Mother', phone: `+99893${String(2000000 + n * 211).padStart(7, '0')}` },
          { name: `${stem} ${fatherFirst} ${FATHERS[(n * 7 + 3) % FATHERS.length]} oʻgʻli`, rel: 'Father', phone: `+99894${String(3000000 + n * 173).padStart(7, '0')}` },
        ],
        notes: [],
      });
    }
  }
  return out;
}
