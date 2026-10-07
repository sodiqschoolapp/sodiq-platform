import type { Texts } from './shape';

/**
 * The Uzbek texts, in Latin script (decided by the owner, task 0.8a). The
 * letters oʻ and gʻ are written with U+02BB and the tutuq belgisi with U+02BC,
 * never with the apostrophe of the keyboard.
 */
export const uz: Texts<'one' | 'other'> = {
  app: {
    name: 'Sodiq School',
    loading: 'Yuklanmoqda…',
  },
  language: {
    label: 'Til',
  },
  theme: {
    label: 'Koʻrinish',
    device: 'Qurilma boʻyicha',
    light: 'Yorugʻ',
    dark: 'Qorongʻi',
  },
  problems: {
    noAnswer: 'Server javob bermadi. Internet aloqasini tekshirib, qayta urinib koʻring.',
    unexpected:
      'Ilovada xatolik yuz berdi. Sahifani yangilang. Takrorlansa, administratorga xabar bering.',
    title: 'Sahifani ochib boʻlmadi',
    retry: 'Qayta urinish',
    notFoundTitle: 'Sahifa topilmadi',
    notFoundText: 'Bu manzilda sahifa yoʻq. Manzilni tekshiring yoki bosh sahifaga oʻting.',
    toHome: 'Bosh sahifaga',
    wait_one:
      'Muvaffaqiyatsiz urinishlar juda koʻp. {{count}} soniyadan keyin qayta urinib koʻring.',
    wait_other:
      'Muvaffaqiyatsiz urinishlar juda koʻp. {{count}} soniyadan keyin qayta urinib koʻring.',
  },
  errors: {
    validation_failed:
      'Kiritilgan maʼlumotlarning bir qismi notoʻgʻri. Maydonlarni tekshirib, qayta urinib koʻring.',
    malformed_request: 'Soʻrovni oʻqib boʻlmadi. Sahifani yangilab, qayta urinib koʻring.',
    not_found: 'Topilmadi. Yozuv oʻchirilgan yoki manzil notoʻgʻri boʻlishi mumkin.',
    payload_too_large:
      'Bir martada juda koʻp maʼlumot yuborildi. Kamroq yuborib, qayta urinib koʻring.',
    unsupported_media_type:
      'Soʻrov server oʻqimaydigan shaklda yuborildi. Sahifani yangilab, qayta urinib koʻring.',
    not_signed_in: 'Siz tizimga kirmagansiz. Qaytadan kiring.',
    sign_in_failed: 'Login yoki parol notoʻgʻri. Ikkalasini tekshirib, qayta urinib koʻring.',
    too_many_attempts: 'Muvaffaqiyatsiz urinishlar juda koʻp. Biroz kutib, qayta urinib koʻring.',
    password_expired:
      'Bu bir martalik parolning muddati tugagan. Administratordan yangisini soʻrang.',
    account_locked: 'Bu hisob bloklangan. Administratorga murojaat qiling.',
    password_change_required: 'Davom etishdan oldin parolingizni oʻzgartiring.',
    current_password_wrong: 'Joriy parol notoʻgʻri.',
    password_unchanged: 'Yangi parol joriy parol bilan bir xil. Boshqasini tanlang.',
    second_step_required: 'Davom etishdan oldin ikkinchi bosqich kodini kiriting.',
    second_step_set_up_required: 'Davom etishdan oldin ikkinchi bosqichni sozlang.',
    second_step_code_wrong:
      'Kod notoʻgʻri yoki avval ishlatilgan. Ilovadagi keyingi kodni kutib, qayta urinib koʻring.',
    second_step_already_on: 'Ikkinchi bosqich allaqachon sozlangan.',
    second_step_not_on: 'Ikkinchi bosqichni sozlash boshlanmagan. Qaytadan boshlang.',
    second_step_cannot_turn_off:
      'Sizning rolingiz uchun ikkinchi bosqich majburiy. Uni oʻchirib boʻlmaydi.',
    permission_denied: 'Bu amal uchun sizda ruxsat yoʻq.',
    own_request:
      'Oʻz soʻrovingizni oʻzingiz koʻrib chiqa olmaysiz. U boshqa tasdiqlovchiga yuboriladi.',
    cross_site_request:
      'Soʻrov boshqa saytdan kelgani uchun rad etildi. Platformani bevosita ochib, qayta urinib koʻring.',
    request_key_reused:
      'Bu amal avval boshqa maʼlumotlar bilan yuborilgan. Sahifani yangilab, qayta urinib koʻring.',
    request_refused:
      'Soʻrov rad etildi. Qayta urinib koʻring yoki administratorga murojaat qiling.',
    internal_error:
      'Serverda xatolik yuz berdi. Birozdan keyin qayta urinib koʻring. Takrorlansa, administratorga xabar bering.',
  },
  signIn: {
    title: 'Kirish',
    login: 'Login',
    password: 'Parol',
    submit: 'Kirish',
    trust: 'Bu qurilmaga ishonish',
    trustNote: 'Bu yerda 7 kun davomida tizimda qolasiz. Umumiy kompyuterda yoqmang.',
    loginMissing: 'Loginni kiriting.',
    passwordMissing: 'Parolni kiriting.',
    sessionEnded: 'Seansingiz tugadi. Qaytadan kiring.',
  },
  code: {
    title: 'Ikkinchi bosqich',
    text: 'Autentifikator ilovasidagi 6 xonali kodni yoki zaxira kodlaringizdan birini kiriting.',
    label: 'Kod',
    missing: 'Kodni kiriting.',
    submit: 'Davom etish',
  },
  password: {
    titleForced: 'Yangi parol oʻrnating',
    titleOwn: 'Parolni oʻzgartirish',
    textForced:
      'Siz bir martalik parol bilan kirdingiz. Davom etishdan oldin oʻz parolingizni oʻrnating.',
    resetBy: 'Parolingizni {{login}} tikladi.',
    current: 'Joriy parol',
    currentOneTime: 'Bir martalik parol',
    new: 'Yangi parol',
    repeat: 'Yangi parol yana bir marta',
    currentMissing: 'Tizimga kirgan parolingizni kiriting.',
    tooShort: 'Parol kamida {{min}} ta belgidan iborat boʻlishi kerak.',
    tooLong: 'Parol koʻpi bilan {{max}} ta belgidan iborat boʻlishi mumkin.',
    same: 'Yangi parol joriy paroldan farq qilishi kerak.',
    mismatch: 'Ikki yangi parol bir xil emas.',
    othersEnd: 'Boshqa seanslaringiz tugatiladi va bu qurilma ishonchli boʻlmay qoladi.',
    submit: 'Parolni oʻzgartirish',
    changed: 'Parol oʻzgartirildi.',
    back: 'Orqaga',
  },
  setUp: {
    title: 'Ikkinchi bosqichni sozlash',
    intro:
      'Sizning rolingiz uchun kirishda ikkinchi bosqich majburiy: telefondagi autentifikator ilovasidan olinadigan kod, masalan Google Authenticator. Ilovani oʻrnating, soʻng boshlang.',
    start: 'Boshlash',
    scan: 'Bu rasmni ilova bilan skanerlang yoki kalitni qoʻlda kiriting. Soʻng ilova koʻrsatgan kodni kiriting.',
    qr: 'Autentifikator ilovasi uchun QR-kod',
    key: 'Kalit',
    code: 'Ilovadagi kod',
    codeMissing: 'Ilovadagi kodni kiriting.',
    confirm: 'Tasdiqlash',
    codesTitle: 'Zaxira kodlar',
    codesText:
      'Har bir kod ilovadagi kod oʻrniga bir marta ishlaydi, masalan telefon yoʻqolganda. Ular faqat hozir koʻrsatiladi. Ularni yozib oling yoki chop eting va ishonchli joyda saqlang.',
    saved: 'Kodlarni saqlab oldim',
    continue: 'Davom etish',
  },
  layout: {
    breadcrumbs: 'Siz shu yerdasiz',
    menu: 'Asosiy menyu',
    account: 'Hisob',
    changePassword: 'Parolni oʻzgartirish',
    signOut: 'Chiqish',
    notTrusted:
      'Bu qurilma ishonchli deb belgilanmadi: kirishda bir martalik parol ishlatilgan. Unga ishonish uchun tizimdan chiqing va «Bu qurilmaga ishonish»ni yoqib, qaytadan kiring.',
    dismiss: 'Yopish',
  },
  search: {
    label: 'Qidiruv',
    shortcut: 'Ctrl+K',
    shortcutMac: '⌘K',
    placeholder: 'Sahifa nomini yozing',
    pages: 'Sahifalar',
    noMatch: 'Mos sahifa topilmadi. Boshqa soʻz bilan urinib koʻring.',
  },
  feedback: {
    button: 'Fikr bildirish',
    title: 'Fikr bildirish',
    text: 'Nima yuz berganini yoki nimani yaxshilash kerakligini yozing. Siz turgan sahifa va rolingiz xabarga qoʻshiladi.',
    message: 'Xabar',
    send: 'Yuborish',
    sent: 'Rahmat. Xabaringiz yuborildi.',
    tooMany_one: 'Soʻnggi 24 soatda {{n}} ta xabar yubordingiz. Keyinroq urinib koʻring.',
    tooMany_other: 'Soʻnggi 24 soatda {{n}} ta xabar yubordingiz. Keyinroq urinib koʻring.',
  },
  list: {
    search: 'Qidirish',
    all: 'Hammasi',
    columns: 'Ustunlar',
    export: 'Eksport',
    selectAll: 'Qidiruv va filtrlarga mos barcha qatorlarni tanlash',
    selectRow: 'Tanlash: {{name}}',
    bulkActions: 'Tanlangan qatorlar bilan amallar',
    selected_one: '{{n}} ta qator tanlandi.',
    selected_other: '{{n}} ta qator tanlandi.',
    selectedNotShown_one: 'Ulardan {{n}} tasi joriy qidiruv va filtrlarda koʻrsatilmayapti.',
    selectedNotShown_other: 'Ulardan {{n}} tasi joriy qidiruv va filtrlarda koʻrsatilmayapti.',
    clearSelection: 'Tanlovni bekor qilish',
    count: 'Koʻrsatilgan: {{matching}} tadan {{shown}} tasi. Roʻyxatda jami: {{total}}.',
    showMore: 'Yana koʻrsatish',
    noMatch: 'Qidiruv va filtrlarga hech narsa mos kelmadi. Ularni oʻzgartiring yoki tozalang.',
    clearSearch: 'Qidiruv va filtrlarni tozalash',
    closePanel: 'Yopish',
    recordGoneTitle: 'Yozuv roʻyxatda yoʻq',
    recordGone:
      'Bu yozuv roʻyxatda yoʻq. U arxivlangan yoki koʻchirilgan boʻlishi mumkin. Panelni yopib, uni roʻyxatdan qidiring.',
  },
  form: {
    save: 'Saqlash',
    saved: 'Saqlandi.',
    required: 'Bu maydonni toʻldiring.',
    tooShort_one: 'Kamida {{n}} ta belgi kiriting.',
    tooShort_other: 'Kamida {{n}} ta belgi kiriting.',
    tooLong_one: 'Koʻpi bilan {{n}} ta belgi kiriting.',
    tooLong_other: 'Koʻpi bilan {{n}} ta belgi kiriting.',
    tooSmall: '{{min}} yoki undan katta son kiriting.',
    tooBig: '{{max}} yoki undan kichik son kiriting.',
    wholeNumber: 'Butun son kiriting, faqat raqamlar bilan.',
    invalid: 'Bu qiymat qabul qilinmaydi. Tekshirib, qaytadan kiriting.',
  },
  confirm: {
    cancel: 'Bekor qilish',
    more: 'va yana {{n}} ta',
  },
  unsent: {
    typed: 'Oʻzgarishlar saqlanmagan',
    failed: 'Saqlab boʻlmadi',
    leaveTitle: 'Saqlamasdan chiqasizmi?',
    leaveText: 'Kiritganlaringiz saqlanmagan va yoʻqoladi:',
    leave: 'Saqlamasdan chiqish',
    stay: 'Qolish',
  },
  sample: {
    title: 'Namunalar',
    intro:
      'Faqat umumiy qismlardan yigʻilgan roʻyxat va forma. Ishlab chiqish uchun; platformaning qismi emas.',
    grade: 'Sinf raqami',
    className: 'Sinf nomi',
    scoreNote: '0 dan 100 gacha. Ball boʻlmasa, boʻsh qoldiring.',
    archiveTitle_one: '{{n}} ta namunaviy oʻquvchi arxivlansinmi?',
    archiveTitle_other: '{{n}} ta namunaviy oʻquvchi arxivlansinmi?',
    archiveText: 'Ular roʻyxatda «Arxivda» holati bilan qoladi.',
    caption: 'Namunaviy oʻquvchilar',
    name: 'Ism',
    class: 'Sinf',
    language: 'Til',
    status: 'Holat',
    score: 'Ball',
    active: 'Faol',
    archived: 'Arxivda',
    uzbek: 'Oʻzbek',
    russian: 'Rus',
    archive: 'Arxivlash',
    exported_one: '{{n}} ta qator eksporti soʻraldi.',
    exported_other: '{{n}} ta qator eksporti soʻraldi.',
    empty: 'Bu yerda namunaviy oʻquvchilar koʻrsatiladi. Bu roʻyxatda hozircha ular yoʻq.',
    showRows: 'Namunalarni koʻrsatish',
  },
  home: {
    title: 'Bosh sahifa',
    empty:
      'Bu sahifada bugun bajarishingiz kerak boʻlgan ishlar koʻrsatiladi. Menyu va vazifalar platforma boʻlimlari ochilgani sari shu yerda paydo boʻladi.',
    teaching:
      'Bugungi darslar va ularning holati, eslatmalar, har bir jurnalga tez kirish va jurnallaringiz boʻyicha ogohlantirish roʻyxati. Fan rahbarlari va katta fan rahbarlari oʻzlarini kutayotgan soʻrovlarni ham koʻradi. Platforma boʻlimlari ochilgani sari sahifa toʻladi.',
    tutor:
      'Sinfingiz: bugungi dars jadvali, hozir kim yoʻq, kun va hafta davomati, sinf boʻyicha ogohlantirish roʻyxati. Platforma boʻlimlari ochilgani sari sahifa toʻladi.',
    attendance_overview:
      'Bugun barcha sinflar davomati va belgilangan foizdan past sinflar. Platforma boʻlimlari ochilgani sari sahifa toʻladi.',
    academic_vice_principal:
      'Bugungi darslar va ularning holati, kerakli almashtirishlar, hozir boʻsh xonalar taxtasi, jadvaldagi toʻqnashuvlar, chorak jarayoni va yopish roʻyxati, filial boʻyicha ogohlantirish roʻyxati. Platforma boʻlimlari ochilgani sari sahifa toʻladi.',
    branch_summary:
      'Filial xulosasi: oʻquvchilar, xodimlar, bugungi davomat va sinf raqamlari boʻyicha natijalar. Platforma boʻlimlari ochilgani sari sahifa toʻladi.',
    later_release:
      'Platformaning sizga tegishli qismi keyingi versiyada qoʻshiladi. Hozir sizdan hech narsa talab qilinmaydi.',
  },
  roles: {
    super_admin: 'Super administrator',
    principal: 'Direktor',
    academic_vice_principal: 'Oʻquv ishlari boʻyicha direktor oʻrinbosari',
    spiritual_vice_principal: 'Maʼnaviy-axloqiy tarbiya boʻyicha direktor oʻrinbosari',
    head_tutor: 'Bosh tyutor',
    tutor: 'Tyutor',
    senior_head_teacher: 'Katta fan rahbari',
    head_teacher: 'Fan rahbari',
    teacher: 'Oʻqituvchi',
    student: 'Oʻquvchi',
    parent: 'Ota-ona',
    hr: 'Kadrlar boʻlimi',
    nurse: 'Hamshira',
    psychologist: 'Psixolog',
    librarian: 'Kutubxonachi',
  },
  menu: {
    open: 'Menyu',
    title: 'Menyu',
    close: 'Yopish',
    current: 'joriy sahifa',
    home: 'Bosh sahifa',
    setup: 'Maktab sozlamalari',
    people: 'Odamlar',
    classes: 'Sinflar va fanlar',
    timetable: 'Dars jadvali',
    journal: 'Jurnal',
    results: 'Natijalar',
    plans: 'Dars rejalari',
    requests: 'Soʻrovlar',
  },
  switcher: {
    role: 'Rol',
    branch: 'Filial',
  },
};
