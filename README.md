<p align="center">
  <img src="assets/avatar.png" width="160" alt="지본" />
</p>

<h1 align="center">지본 (Zibone)</h1>

<p align="center">GitHub PR이 올라오면 디스코드 채널에서 리뷰어를 알아서 태그해 주는 봇</p>

---

## 기능

| 상황 | 디스코드 알림 | 태그 대상 |
| --- | --- | --- |
| PR 생성 / Draft 해제 / 다시 열림 | 🔔 PR 링크 + 제목 + 브랜치 | GitHub Reviewers, 없으면 채널 담당자 |
| 새 커밋 push | 🔄 변경사항 확인 요청 | Reviewers + 이전에 리뷰한 사람, 없으면 담당자 |
| GitHub에서 Reviewers 지정 / Re-request review | 👀 리뷰 요청 | 요청받은 사람 |
| 리뷰 제출 (Approve / Changes requested / Comment) | ✅ 🛠️ 💬 + 리뷰 내용 | PR 작성자 |
| 리뷰 없이 방치 (기본 24시간) | ⏰ 리마인더 | 아직 리뷰 안 한 사람 |
| 머지 / 닫힘 | 🎉 🚫 | 없음 |

- 짧은 시간에 여러 번 push 해도 5분에 한 번만 알려요.
- PR 작성자는 자기 PR 알림에서 태그되지 않아요.
- 리마인더는 `REMINDER_START_HOUR`~`REMINDER_END_HOUR` 사이에만 보내요 (기본 9시~22시).

## 디스코드 명령어

| 명령어 | 설명 |
| --- | --- |
| `/레포 등록 repo:owner/name` | 이 채널로 해당 레포 PR 알림을 받아요 (채널 관리 권한 필요) |
| `/레포 해제 repo:owner/name` · `/레포 목록` | 연결 해제 / 연결된 레포 보기 |
| `/연결 github:아이디` | 내 디스코드 계정과 GitHub 계정 연결 (각자 한 번) |
| `/연결 github:아이디 user:@사람` | 다른 사람 대신 연결 (서버 관리 권한 필요) |
| `/연결해제` | GitHub 연결 해제 |
| `/담당자 추가 user:@사람` | 이 채널에서 태그할 사람 추가 |
| `/담당자 제거` · `/담당자 목록` · `/담당자 초기화` | 담당자 관리 |
| `/도움말` | 사용법 |

**태그 규칙:** PR에 GitHub Reviewers가 지정돼 있으면 그 사람을 태그하고, 아무도 지정되지 않았으면 `/담당자`로 저장한 사람을 태그해요. GitHub Reviewers를 디스코드에서 태그하려면 그 사람이 `/연결`을 해 둬야 해요.

---

## 설치

### 1. 디스코드 봇 만들기

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** → 이름 `지본`
2. **General Information**에서 App Icon에 `assets/avatar.png` 업로드
3. **Bot** 탭
   - Username `지본`, Icon에 `assets/avatar.png` 업로드
   - **Reset Token** → 토큰 복사 (`DISCORD_TOKEN`). 이 토큰은 절대 공개하면 안 돼요.
   - Privileged Gateway Intents는 켤 필요 없어요.
4. **OAuth2 → URL Generator**
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `View Channels`, `Send Messages`, `Embed Links`
   - 생성된 URL로 봇을 서버에 초대

### 2. Railway에 배포

1. [Railway](https://railway.com) → **New Project → Deploy from GitHub repo** → 이 레포 선택
   (`Dockerfile`과 `railway.json`이 있어서 빌드 설정은 자동이에요)
2. 서비스 **Variables**에 추가

   | 이름 | 값 |
   | --- | --- |
   | `DISCORD_TOKEN` | 1단계에서 복사한 봇 토큰 |
   | `GITHUB_WEBHOOK_SECRET` | 아무 긴 랜덤 문자열 (예: `openssl rand -hex 32` 결과) |
   | `DATABASE_PATH` | `/data/bot.db` |
   | `REMINDER_HOURS` | `24` (선택, `0`이면 리마인더 끔) |

3. 서비스 우클릭 → **Attach Volume** → Mount path `/data`
   (볼륨이 없으면 재배포할 때 담당자·연결 설정이 날아가요)
4. **Settings → Networking → Generate Domain** → 예: `zibone-production.up.railway.app`
5. 브라우저에서 `https://<도메인>/health` 접속해서 `ok` 나오면 성공

### 3. GitHub 레포에 Webhook 연결

알림을 받을 레포마다 한 번씩 설정해요 (조직 전체에 걸려면 Organization Settings에서 한 번만 해도 돼요).

1. 레포 **Settings → Webhooks → Add webhook**
2. 입력값
   - Payload URL: `https://<도메인>/github/webhook`
   - Content type: **`application/json`**
   - Secret: Railway에 넣은 `GITHUB_WEBHOOK_SECRET`과 같은 값
   - Which events: **Let me select individual events** → `Pull requests`, `Pull request reviews` 체크
3. 저장 후 Recent Deliveries에 초록 체크(ping)가 뜨면 연결 완료

### 4. 디스코드에서 설정

```
/레포 등록 repo:minwoo-3/my-app
/연결 github:내깃허브아이디        ← 팀원 각자
/담당자 추가 user:@민수
```

이제 PR을 올려 보세요.

---

## 로컬 실행

Node.js 22.13 이상이 필요해요.

```bash
npm install
cp .env.example .env   # 값 채우기
npm run dev
```

로컬에서 GitHub Webhook을 받으려면 [smee.io](https://smee.io)나 `ngrok http 3000` 같은 터널을 쓰세요.

학교 서버처럼 Docker가 있는 곳이면 이렇게도 실행할 수 있어요.

```bash
docker build -t zibone .
docker run -d --name zibone --env-file .env -e DATABASE_PATH=/data/bot.db -v zibone-data:/data -p 3000:3000 zibone
```

## 구조

```
src/
  index.ts             진입점: 디스코드 로그인 + Webhook 서버 + 리마인더
  config.ts            환경변수
  db.ts                SQLite (node:sqlite) 저장소
  notify.ts            누구를 태그할지 결정하고 메시지 생성
  reminder.ts          방치된 PR 리마인더
  discord/client.ts    디스코드 클라이언트, 메시지 전송
  discord/commands.ts  슬래시 명령어
  github/webhook.ts    Webhook 수신 + 서명 검증
  github/handlers.ts   PR / 리뷰 이벤트 처리
```
