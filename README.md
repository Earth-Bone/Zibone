<p align="center">
  <img src="assets/avatar.png" width="160" alt="지본" />
</p>

<h1 align="center">지본 (Zibone)</h1>

<p align="center">PR 올리면 디스코드에서 리뷰어를 알아서 태그해 주는 봇 🌏</p>

---

> "PR 올렸어요, 리뷰 부탁드려요 @민수 @지영"
> "아직 안 보셨나요…? @민수"
> "수정 반영했어요! 다시 봐주세요 @민수 @지영"

이런 메시지, 이제 지본이 대신 보내요.

- ✔️ PR이 올라오면 PR 링크와 함께 리뷰어를 자동으로 태그해요
- ✔️ 새 커밋을 push하면 리뷰어를 다시 불러요
- ✔️ Approve·변경 요청·코멘트가 달리면 작성자에게 알려요
- ✔️ GitHub에서 리뷰어를 지정하면 그 사람만 콕 집어 태그해요
- ✔️ 리뷰가 24시간 동안 없으면 리마인더를 보내요
- ✔️ 채널마다 태그할 담당자를 `/담당자` 명령어로 직접 골라요
- 🔒 GitHub 로그인으로 본인과 레포 권한을 확인해서, 남의 레포 알림은 받을 수 없어요

GitHub에서는 평소처럼 일하세요. 부르는 건 지본이 할게요.

## 바로 쓰기

1. [디스코드 서버에 지본 초대](https://discord.com/oauth2/authorize?client_id=1554520607989960724&permissions=19456&integration_type=0&scope=applications.commands+bot)
2. [GitHub 레포에 지본 App 설치](https://github.com/apps/zi-bone/installations/new)
3. 알림 받을 채널에서 `/레포 등록 repo:https://github.com/올가/레포` → GitHub 로그인
4. 팀원 각자 `/연결` → GitHub 로그인
5. (선택) `/담당자 추가 user:@이름`

아래는 직접 지본을 운영(배포)하려는 경우의 안내예요.

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
| `/레포 등록 repo:https://github.com/owner/name` | GitHub 로그인으로 레포 쓰기 권한을 확인한 뒤 이 채널로 PR 알림을 받아요 (레포에 GitHub App 설치 필요) |
| `/레포 해제 repo:https://github.com/owner/name` · `/레포 목록` | 연결 해제 / 연결된 레포 보기 |
| `/연결` | GitHub 로그인으로 내 디스코드 계정과 GitHub 계정 연결 (각자 한 번) |
| `/연결해제` | GitHub 연결 해제 |
| `/담당자 추가 user:@사람` | 이 채널에서 태그할 사람 추가 |
| `/담당자 제거` · `/담당자 목록` · `/담당자 초기화` | 담당자 관리 |
| `/도움말` | 사용법 |

**보안:** `/연결`과 `/레포 등록`은 GitHub 로그인을 거쳐요. 남의 GitHub 아이디로 연결하거나, 쓰기 권한이 없는 레포의 PR 알림을 받아 갈 수 없어요. GitHub 토큰은 확인에만 쓰고 저장하지 않아요.

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

### 3. GitHub App 만들기 (운영자, 한 번만)

지본은 GitHub App으로 PR 이벤트를 받아요. App을 설치한 레포에는 Webhook이 자동으로 연결돼서 레포마다 Webhook을 만들 필요가 없어요.

1. 브라우저에서 `https://<도메인>/setup` 접속
2. (선택) App 이름, 올가 소유 여부 입력 → **이름/소유자 적용**
3. **GitHub에서 "Zibone" App 만들기** → GitHub 화면에서 **Create GitHub App**
4. 자동으로 설치 화면으로 이동해요. 4단계로 이어서 진행하세요.

Webhook 주소, 권한(Pull requests: Read-only), 이벤트(`Pull request`, `Pull request review`)는 모두 자동으로 채워지고, App의 Webhook secret은 봇이 직접 저장해요. `/setup`은 한 번 App을 만들면 설치 링크만 보여줘요.

### 3-1. GitHub 로그인 설정 (운영자, 한 번만)

`/setup`으로 새로 만든 App은 자동으로 설정돼요. 그 전에 만든 App이면 아래를 한 번 해 주세요.

1. GitHub → Settings → Developer settings → GitHub Apps → 지본 App → **Edit**
2. **Callback URL**에 `https://<도메인>/auth/github/callback` 추가 → Save changes
3. 같은 화면의 **Client ID** 복사, **Generate a new client secret**으로 secret 생성
4. Railway Variables에 추가 후 Deploy

   | 이름 | 값 |
   | --- | --- |
   | `GITHUB_CLIENT_ID` | Client ID |
   | `GITHUB_CLIENT_SECRET` | 생성한 client secret |

### 4. 레포에 App 설치 (레포 관리자, 레포마다 한 번)

1. 설치 링크 열기 → 설치할 계정/올가 선택
2. **All repositories** 또는 **Only select repositories**에서 레포 선택 → **Install**
3. 올가 관리자가 아니면 설치 요청이 관리자에게 가고, 승인되면 설치돼요.

레포에 예전에 직접 만든 Webhook이 있다면 지워도 돼요. 둘 다 있어도 지본이 중복 이벤트를 걸러서 알림은 한 번만 가요.

### 5. 디스코드에서 설정

```
/레포 등록 repo:https://github.com/Earth-Bone/my-app
/연결                               ← 팀원 각자, GitHub 로그인
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
