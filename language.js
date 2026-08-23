/**
 * Everything the site says, in each language it says it in.
 *
 * The family this gallery is for reads Korean, so the language is a setting in
 * config.json rather than something baked into the pages. What is here is not a
 * word-for-word rendering of the English: Korean counts photos in 장 and an age
 * in 개월 and 살, with no plural to agree with, and puts the year before the
 * month — so each sentence is written twice, in whatever shape that language
 * actually uses. The entries with numbers in them are functions for exactly that
 * reason: English needs a plural where Korean needs a counter, and neither can
 * be produced by filling a blank in the other's sentence.
 *
 * The language is held here rather than passed from function to function. It is
 * a fact about the page, fixed before anything is drawn and never varying while
 * it is open, and threading it through every layer that says something — down to
 * the coordinate checks in corrections.js — would be a parameter carried a long
 * way to say the same thing every time.
 *
 * The tables are exported for the tests, which is what keeps them honest: every
 * key one language has, the other has, and every key the pages ask for is in
 * both. Without that a missing Korean sentence would quietly come out in
 * English, on a page nobody reads in English.
 */

/** What an unset or unrecognised setting falls back to, with nothing missing. */
export const DEFAULT_LANGUAGE = "en";

/* ------------------------------------------------------------------ English */

// A photo, counted. This is the shape Korean does not have: the noun changes
// with the number, so every sentence that counts anything has to agree with it.
const photos = (count) => `${count} photo${count === 1 ? "" : "s"}`;

const en = {
  /* -- the gallery ------------------------------------------------------- */
  "gallery.views": "View",
  "gallery.timeline": "Timeline",
  "gallery.map": "Map",
  "gallery.add": "Add",
  "gallery.add.label": "Add photos",
  "gallery.loading": "Loading photos…",
  "gallery.empty": "No photos yet. Add some from the upload page and they will appear here.",
  "gallery.photo": "Photo",
  "gallery.photoIn": ({ place }) => `Photo taken in ${place}`,
  "gallery.close": "Close",
  "gallery.previous": "Previous photo",
  "gallery.next": "Next photo",
  "gallery.approximate": " (date approximate)",
  "gallery.share": "Send this photo",
  "gallery.share.copied": "Link copied.",
  "gallery.share.failed": "This photo could not be sent.",
  "gallery.map.unavailable": "The map could not be loaded.",
  "gallery.map.none": "None of the photos have location information yet.",
  "gallery.map.missing": ({ count }) =>
    `${photos(count)} without location ${count === 1 ? "is" : "are"} on the timeline only.`,
  "gallery.age.newborn": "newborn",
  "gallery.age.months": ({ months }) => `${months} month${months === 1 ? "" : "s"}`,
  "gallery.age.years": ({ years, months }) => {
    const yearPart = `${years} year${years === 1 ? "" : "s"}`;
    return months === 0 ? yearPart : `${yearPart} ${months} month${months === 1 ? "" : "s"}`;
  },

  /* -- the upload page --------------------------------------------------- */
  "upload.title": "Add photos",
  "upload.toGallery": "← Gallery",

  "upload.setup.heading": "One-time setup",
  "upload.setup.note":
    "If a device that can already add photos is to hand, it can show a setup code for this " +
    "one — no token to type. Otherwise, carry on below.",

  "upload.passphrase.intro":
    "If you know the upload passphrase, that is all this device needs. Unlocking takes a " +
    "moment — it is made slow deliberately.",
  "upload.passphrase.placeholder": "Upload passphrase",
  "upload.passphrase.unlock": "Unlock",
  "upload.passphrase.unlocking": "Unlocking…",
  "upload.passphrase.none": "No passphrase? Set this device up with a token of its own instead.",
  "upload.passphrase.absent": "There is no passphrase set up for this site. Use a token below.",
  "upload.passphrase.stale":
    "This page cannot read the published token — this may be an old copy of the page. " +
    "Reload and try again.",
  "upload.passphrase.wrong": "That passphrase did not work.",
  "upload.passphrase.tokenRefused": ({ reason }) =>
    `The passphrase worked, but the token behind it did not: ${reason}`,

  "upload.token.intro": ({ strong, em, repo }) => [
    "This device needs a GitHub token to add photos. Create a ",
    strong("fine-grained personal access token"),
    " with ",
    em("Contents: Read and write"),
    " on the ",
    repo,
    " repository, then paste it here. It is stored only in this browser.",
  ],
  "upload.token.gotchas": ({ strong, em }) => [
    "Two things catch people out: create it while ",
    strong("signed in as the account that owns this site"),
    ", and under ",
    em("Repository access"),
    " choose ",
    em("Only select repositories"),
    " and tick that repository — a token that cannot see it fails with a bare “Not Found”.",
  ],
  "upload.token.create": "Create a token on GitHub →",
  "upload.token.placeholder": "github_pat_…",
  "upload.token.save": "Save token",
  "upload.token.refused": ({ reason }) => `That token did not work: ${reason}`,
  "upload.token.stale": ({ reason }) =>
    `That saved token no longer works (${reason}). Please add a new one.`,
  "upload.token.scanned": ({ reason }) => `The code you scanned did not work: ${reason}`,
  "upload.token.forget": "Forget token on this device",
  "upload.token.forgotten": "Token removed from this device.",

  "upload.expiry.days": ({ days }) => `This token expires in ${days} days.`,
  "upload.expiry.tomorrow": "This token expires tomorrow.",
  "upload.expiry.today": "This token expires today.",
  "upload.expiry.replace": "Create a replacement →",

  "upload.failed.heading": ({ count }) => `${photos(count)} could not be processed`,
  "upload.failed.path": "photos/failed/",
  "upload.failed.kept": ({ link }) => [
    "They are kept in ",
    link,
    " — delete one there and it will drop off this list.",
  ],

  "upload.choose": "Choose photos",
  "upload.drag": "or drag them here",
  "upload.progress.running": ({ done, total }) => `${done} of ${photos(total)} done`,
  "upload.progress.summary": ({ added, failed }) =>
    `${added === 0 ? "No photos added" : `${photos(added)} added`}, ${
      failed === 0 ? "none" : failed
    } failed.`,
  "upload.queue.waiting": "waiting",
  "upload.queue.uploading": "uploading…",
  "upload.queue.added": "added",
  "upload.queue.notPhoto": "not a photo",
  "upload.queue.tooLarge": "too large to upload",
  "upload.done": ({ link }) => [
    "Uploaded. The site rebuilds automatically in a minute or two — ",
    link,
    ".",
  ],
  "upload.done.link": "watch progress",

  "upload.arrival.watching": ({ done, total }) =>
    `Waiting for them to appear in the gallery — ${done} of ${total} so far.`,
  "upload.arrival.arrived": ({ count, link }) => [
    `${photos(count)} ${count === 1 ? "is" : "are"} in the gallery now — `,
    link,
    ".",
  ],
  "upload.arrival.link": "have a look",
  // The likeliest reason by far, and one nothing else would ever say: a photo
  // that is already in the gallery is skipped without a word, and the file it
  // was uploaded as simply disappears.
  "upload.arrival.slow": ({ count, link }) => [
    `${photos(count)} ${count === 1 ? "has" : "have"} not appeared. ${
      count === 1 ? "It may already have been" : "They may already have been"
    } in the gallery, or the site may still be rebuilding — `,
    link,
    ".",
  ],

  "upload.handoff.heading": "Set up another device",
  "upload.handoff.warning":
    "Anyone who photographs this code can add photos to the gallery for as long as this " +
    "token lasts. Show it to the other phone and close it again.",
  "upload.handoff.point": "Point the other phone's camera at it — there is nothing to type.",
  "upload.handoff.done": "Done",
  "upload.handoff.codeLabel": "Setup code",

  "upload.fix.heading": "Fix a photo",
  "upload.fix.back": "← Adding photos",
  "upload.fix.intro":
    "A photo that arrived with its metadata stripped lands on the day it was uploaded, with " +
    "no place. Fill in what it should say and the next build moves it — on the timeline and " +
    "on the map. Empty a field to go back to whatever the photo itself says.",
  "upload.fix.note":
    "These are the photos added most recently, in timeline order. One added a moment ago is " +
    "not here yet: it appears once the site has rebuilt, which is what reads the photo and " +
    "gives it a name here.",
  "upload.fix.reading": "Reading the photos…",
  "upload.fix.empty": "No photos here yet.",
  "upload.fix.unreadable": ({ reason }) => `The corrections could not be read: ${reason}`,
  "upload.fix.taken": "Taken",
  "upload.fix.guessed": "date is a guess",
  "upload.fix.unrecorded": "nothing in the photo",
  "upload.fix.placeHint": "looked up from the location",
  "upload.fix.save": "Save",
  "upload.fix.saving": "Saving…",
  "upload.fix.saved": "Saved. The next build moves it.",

  "upload.place.heading": "Name a place",
  "upload.place.intro":
    "Every photo taken within the radius is labelled with this name instead of whatever " +
    "OpenStreetMap calls it — including the ones already published.",
  "upload.place.namePlaceholder": "Grandma's house",
  "upload.place.radius": "Radius in metres",
  "upload.place.add": "Add place",
  "upload.place.added": "Added. The next build relabels the photos near it.",
  "upload.place.named": ({ names }) => `Named already: ${names}`,

  "upload.map.pick": "Find it on the map",
  "upload.map.hint": "Tap the map, or drag the pin. The fields below follow it.",
  "upload.map.locate": "Use where I am now",
  "upload.map.locating": "Finding where you are…",
  "upload.map.refused": "This device would not say where it is.",

  "upload.field.name": "Name",
  "upload.field.lat": "Latitude",
  "upload.field.lon": "Longitude",
  "upload.field.place": "Place",

  /* -- talking to GitHub -------------------------------------------------- */
  "github.status": ({ status }) => `GitHub returned ${status}`,
  "github.tokenInvalid": "this token is invalid, or it has expired",
  "github.repoUnseen": ({ login, owner, name }) =>
    `this token is owned by ${login} but cannot see ${owner}/${name}. ` +
    `Edit the token and make sure "Repository access" includes ${name}.`,
  "github.wrongAccount": ({ login, owner, name }) =>
    `this token belongs to ${login}, but this site lives in ${owner}'s account. ` +
    `Create the token while signed in as ${owner}, with ${owner}/${name} selected.`,
  "github.cannotWrite": 'token cannot write here — it needs "Contents: Read and write"',

  /* -- the corrections file ----------------------------------------------- */
  "corrections.latitude": "latitude",
  "corrections.longitude": "longitude",
  "corrections.invalidJson": ({ file, reason }) => `${file} is not valid JSON: ${reason}`,
  "corrections.unusable": ({ file, container }) =>
    `${file} cannot be edited: "${container}" is not what it should be`,
  "corrections.placeNeedsName": "a place needs a name",
  "corrections.needsNumber": ({ field }) => `the ${field} must be a number`,
  "corrections.notANumber": ({ value, field }) =>
    `"${value}" is not a number — the ${field} must be a number`,
  "corrections.outOfRange": ({ field, low, high }) =>
    `the ${field} must be between ${low} and ${high}`,
  "corrections.notADate": ({ value }) =>
    `"${value}" is not a date the pipeline can read — try 2025-12-25T08:00`,
  "corrections.needsRadius": "the radius must be a number of metres",
};

/* ------------------------------------------------------------------- Korean */

// 장 is the counter for flat things, photographs among them, and it does not
// change with the number. Where English writes "3 photos", Korean writes
// 사진 3장 — the noun first, the count and its counter after it.
const jang = (count) => `사진 ${count}장`;

const ko = {
  /* -- the gallery ------------------------------------------------------- */
  "gallery.views": "보기",
  "gallery.timeline": "타임라인",
  "gallery.map": "지도",
  "gallery.add": "추가",
  "gallery.add.label": "사진 추가",
  "gallery.loading": "사진을 불러오는 중…",
  "gallery.empty": "아직 사진이 없어요. 추가 페이지에서 올리면 여기에 나타나요.",
  "gallery.photo": "사진",
  "gallery.photoIn": ({ place }) => `${place}에서 찍은 사진`,
  "gallery.close": "닫기",
  "gallery.previous": "이전 사진",
  "gallery.next": "다음 사진",
  "gallery.approximate": " (날짜는 추정)",
  "gallery.share": "이 사진 보내기",
  "gallery.share.copied": "링크를 복사했어요.",
  "gallery.share.failed": "사진을 보내지 못했어요.",
  "gallery.map.unavailable": "지도를 불러오지 못했어요.",
  "gallery.map.none": "아직 위치가 기록된 사진이 없어요.",
  "gallery.map.missing": ({ count }) => `위치가 없는 ${jang(count)}은 타임라인에만 있어요.`,
  "gallery.age.newborn": "신생아",
  "gallery.age.months": ({ months }) => `${months}개월`,
  "gallery.age.years": ({ years, months }) =>
    months === 0 ? `${years}살` : `${years}살 ${months}개월`,

  /* -- the upload page --------------------------------------------------- */
  "upload.title": "사진 추가",
  "upload.toGallery": "← 갤러리",

  "upload.setup.heading": "처음 한 번만 하는 설정",
  "upload.setup.note":
    "이미 사진을 올릴 수 있는 기기가 옆에 있다면 그 기기에서 설정 코드를 띄울 수 있어요. " +
    "그러면 토큰을 입력하지 않아도 돼요. 없다면 아래에서 이어서 하세요.",

  "upload.passphrase.intro":
    "업로드 암호를 알고 있다면 이 기기에 필요한 건 그것뿐이에요. 여는 데 잠깐 걸려요 — " +
    "일부러 느리게 만들어 두었어요.",
  "upload.passphrase.placeholder": "업로드 암호",
  "upload.passphrase.unlock": "열기",
  "upload.passphrase.unlocking": "여는 중…",
  "upload.passphrase.none": "암호가 없나요? 대신 이 기기에 토큰을 직접 넣어 설정하세요.",
  "upload.passphrase.absent": "이 사이트에는 설정된 암호가 없어요. 아래에서 토큰을 쓰세요.",
  "upload.passphrase.stale":
    "이 페이지가 게시된 토큰을 읽지 못해요 — 오래된 페이지일 수 있어요. " +
    "새로고침한 뒤 다시 해보세요.",
  "upload.passphrase.wrong": "그 암호로는 열리지 않았어요.",
  "upload.passphrase.tokenRefused": ({ reason }) => `암호는 맞았지만 그 안의 토큰이 거부됐어요: ${reason}`,

  "upload.token.intro": ({ strong, em, repo }) => [
    "사진을 올리려면 이 기기에 GitHub 토큰이 필요해요. ",
    repo,
    " 저장소에 ",
    em("Contents: Read and write"),
    " 권한을 준 ",
    strong("fine-grained personal access token"),
    "을 만들어 여기에 붙여넣으세요. 토큰은 이 브라우저에만 저장돼요.",
  ],
  "upload.token.gotchas": ({ strong, em }) => [
    "두 가지를 자주 놓쳐요. ",
    strong("이 사이트를 가진 계정으로 로그인한 채로"),
    " 만들어야 하고, ",
    em("Repository access"),
    "에서 ",
    em("Only select repositories"),
    "를 골라 그 저장소를 체크해야 해요. 저장소가 보이지 않는 토큰은 그저 “Not Found”라고만 합니다.",
  ],
  "upload.token.create": "GitHub에서 토큰 만들기 →",
  "upload.token.placeholder": "github_pat_…",
  "upload.token.save": "토큰 저장",
  "upload.token.refused": ({ reason }) => `그 토큰은 통하지 않았어요: ${reason}`,
  "upload.token.stale": ({ reason }) => `저장된 토큰이 더 이상 통하지 않아요 (${reason}). 새 토큰을 넣어 주세요.`,
  "upload.token.scanned": ({ reason }) => `스캔한 코드가 통하지 않았어요: ${reason}`,
  "upload.token.forget": "이 기기에서 토큰 지우기",
  "upload.token.forgotten": "이 기기에서 토큰을 지웠어요.",

  "upload.expiry.days": ({ days }) => `이 토큰은 ${days}일 뒤에 만료돼요.`,
  "upload.expiry.tomorrow": "이 토큰은 내일 만료돼요.",
  "upload.expiry.today": "이 토큰은 오늘 만료돼요.",
  "upload.expiry.replace": "새 토큰 만들기 →",

  "upload.failed.heading": ({ count }) => `읽지 못한 ${jang(count)}`,
  "upload.failed.path": "photos/failed/",
  "upload.failed.kept": ({ link }) => [
    link,
    "에 그대로 있어요. 거기서 지우면 이 목록에서도 사라져요.",
  ],

  "upload.choose": "사진 고르기",
  "upload.drag": "또는 여기에 끌어다 놓기",
  "upload.progress.running": ({ done, total }) => `${total}장 중 ${done}장 완료`,
  "upload.progress.summary": ({ added, failed }) =>
    `${added === 0 ? "추가된 사진 없음" : `${added}장 추가`}, ${
      failed === 0 ? "실패 없음" : `${failed}장 실패`
    }.`,
  "upload.queue.waiting": "대기 중",
  "upload.queue.uploading": "올리는 중…",
  "upload.queue.added": "추가됨",
  "upload.queue.notPhoto": "사진이 아니에요",
  "upload.queue.tooLarge": "너무 커서 올릴 수 없어요",
  "upload.done": ({ link }) => ["올렸어요. 1~2분 뒤에 사이트가 다시 만들어져요 — ", link, "."],
  "upload.done.link": "진행 상황 보기",

  // 올라오다, the same verb the sentence below finishes with: what is being
  // waited for and what then happened should not be two different words.
  "upload.arrival.watching": ({ done, total }) =>
    `갤러리에 올라오기를 기다리는 중 — ${total}장 중 ${done}장 도착.`,
  "upload.arrival.arrived": ({ count, link }) => [`${jang(count)}이 갤러리에 올라왔어요 — `, link, "."],
  "upload.arrival.link": "보러 가기",
  "upload.arrival.slow": ({ count, link }) => [
    `${jang(count)}은 아직 보이지 않아요. 이미 갤러리에 있던 사진이거나, 사이트가 아직 다시 ` +
      "만들어지는 중일 수 있어요 — ",
    link,
    ".",
  ],

  "upload.handoff.heading": "다른 기기 설정하기",
  "upload.handoff.warning":
    "이 코드를 찍은 사람은 누구나, 이 토큰이 살아 있는 동안 갤러리에 사진을 올릴 수 있어요. " +
    "다른 기기에 보여준 뒤 바로 닫으세요.",
  "upload.handoff.point": "다른 기기의 카메라를 코드에 비추기만 하면 돼요. 입력할 것은 없어요.",
  "upload.handoff.done": "완료",
  "upload.handoff.codeLabel": "설정 코드",

  "upload.fix.heading": "사진 고치기",
  "upload.fix.back": "← 사진 추가",
  "upload.fix.intro":
    "메타데이터가 지워진 채로 온 사진은 올린 날짜에, 장소 없이 놓여요. 어떻게 되어야 하는지 " +
    "채워 넣으면 다음 빌드에서 타임라인과 지도의 자리가 옮겨져요. 칸을 비우면 사진 자체가 " +
    "말하는 값으로 돌아가요.",
  "upload.fix.note":
    "가장 최근에 올린 사진들이 타임라인 순서로 있어요. 방금 올린 사진은 아직 없어요. " +
    "사이트가 다시 만들어지면서 사진을 읽고 이름을 붙인 뒤에 나타나요.",
  "upload.fix.reading": "사진을 읽는 중…",
  "upload.fix.empty": "아직 사진이 없어요.",
  "upload.fix.unreadable": ({ reason }) => `수정 내용을 읽지 못했어요: ${reason}`,
  "upload.fix.taken": "찍은 때",
  "upload.fix.guessed": "날짜는 추정",
  "upload.fix.unrecorded": "사진에 없음",
  "upload.fix.placeHint": "위치로 찾은 이름",
  "upload.fix.save": "저장",
  "upload.fix.saving": "저장하는 중…",
  "upload.fix.saved": "저장했어요. 다음 빌드에서 옮겨져요.",

  "upload.place.heading": "장소 이름 짓기",
  "upload.place.intro":
    "반경 안에서 찍은 사진은 OpenStreetMap이 뭐라고 부르든 이 이름으로 표시돼요. " +
    "이미 올라간 사진도 함께 바뀌어요.",
  "upload.place.namePlaceholder": "할머니집",
  "upload.place.radius": "반경 (미터)",
  "upload.place.add": "장소 추가",
  "upload.place.added": "추가했어요. 다음 빌드에서 근처 사진의 이름이 바뀌어요.",
  "upload.place.named": ({ names }) => `이미 이름 지은 곳: ${names}`,

  "upload.map.pick": "지도에서 찾기",
  "upload.map.hint": "지도를 누르거나 핀을 끌어 옮기세요. 아래 칸은 따라 바뀌어요.",
  "upload.map.locate": "지금 있는 곳 쓰기",
  "upload.map.locating": "위치를 찾는 중…",
  "upload.map.refused": "이 기기가 위치를 알려주지 않았어요.",

  "upload.field.name": "이름",
  "upload.field.lat": "위도",
  "upload.field.lon": "경도",
  "upload.field.place": "장소",

  /* -- talking to GitHub -------------------------------------------------- */
  "github.status": ({ status }) => `GitHub이 ${status} 응답을 보냈어요`,
  "github.tokenInvalid": "이 토큰은 유효하지 않거나 만료됐어요",
  "github.repoUnseen": ({ login, owner, name }) =>
    `이 토큰은 ${login} 계정의 것인데, ${owner}/${name} 저장소를 볼 수 없어요. ` +
    `토큰을 고쳐서 "Repository access"에 ${name} 저장소를 넣어 주세요.`,
  "github.wrongAccount": ({ login, owner, name }) =>
    `이 토큰은 ${login} 계정의 것인데, 이 사이트는 ${owner} 계정에 있어요. ` +
    `${owner} 계정으로 로그인한 채로, ${owner}/${name} 저장소를 골라 토큰을 만드세요.`,
  "github.cannotWrite": '이 토큰은 여기에 쓸 수 없어요 — "Contents: Read and write" 권한이 필요해요',

  /* -- the corrections file ----------------------------------------------- */
  "corrections.latitude": "위도",
  "corrections.longitude": "경도",
  "corrections.invalidJson": ({ file, reason }) => `${file} 파일이 올바른 JSON이 아니에요: ${reason}`,
  "corrections.unusable": ({ file, container }) =>
    `${file} 파일을 고칠 수 없어요: "${container}" 항목이 있어야 할 모양이 아니에요`,
  "corrections.placeNeedsName": "장소에는 이름이 필요해요",
  "corrections.needsNumber": ({ field }) => `${field} 값은 숫자여야 해요`,
  // The value goes last, where no particle has to follow it: Korean picks 은 or
  // 는 by the sound the word ends on, and what was typed into the box could end
  // on anything at all.
  "corrections.notANumber": ({ value, field }) => `${field} 값은 숫자여야 해요 — 입력한 값: "${value}"`,
  "corrections.outOfRange": ({ field, low, high }) => `${field} 값은 ${low}에서 ${high} 사이여야 해요`,
  "corrections.notADate": ({ value }) =>
    `파이프라인이 읽을 수 있는 날짜가 아니에요 — 2025-12-25T08:00 처럼 써 주세요. 입력한 값: "${value}"`,
  "corrections.needsRadius": "반경은 미터 단위의 숫자여야 해요",
};

/* ---------------------------------------------------------------- the setting */

/** Every language the site has, by the code config.json names it with. */
export const TRANSLATIONS = { en, ko };

let current = DEFAULT_LANGUAGE;

/**
 * Put a language to use, and say which one that came to.
 *
 * A setting that is missing, blank or names a language the site does not have
 * falls back to English rather than to a half-translated page. A browser writes
 * a language with its region — "ko-KR" — and a setting copied from one should
 * mean what it looks like it means.
 */
export function useLanguage(code) {
  const [named] = String(code ?? "").trim().toLowerCase().split("-");
  // hasOwn, not `in`: every object answers to "constructor", and a setting
  // saying that would otherwise be taken for a language.
  current = Object.hasOwn(TRANSLATIONS, named) ? named : DEFAULT_LANGUAGE;
  return current;
}

/** The language in use, as a tag `Intl` and `<html lang>` both understand. */
export const language = () => current;

/**
 * What to say for `key`, with `params` filled into it.
 *
 * A key the language has not got falls back to English, and one no table has at
 * all comes out as the key itself: a page is allowed to be in the wrong
 * language for a moment, but never to have a hole in it. The tests are what
 * keep either from happening — nothing here can notice at runtime.
 *
 * A few sentences carry marked-up parts and come back as an array of them,
 * for the caller to put into an element.
 */
export function t(key, params) {
  const said = TRANSLATIONS[current][key] ?? en[key] ?? key;
  return typeof said === "function" ? said(params ?? {}) : said;
}
