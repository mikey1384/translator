const SELECTED_LANGUAGE =
  (import.meta.env.VITE_SELECTED_LANGUAGE as string) || 'en';

const languageObj: {
  [section: string]: {
    [language: string]: string;
  };
} = {
  abort: {
    en: 'Abort',
    kr: '게임취소'
  },
  achievements: {
    en: 'Achievements',
    kr: '업적'
  },
  acceptDraw: {
    en: 'Accept Draw',
    kr: '무승부 수락'
  },
  accountMgmt: {
    en: 'Account Mgmt',
    kr: '계정관리'
  },
  accountType: {
    en: 'Account Type',
    kr: '계정유형'
  },
  accountTypes: {
    en: 'Account Types',
    kr: '계정유형'
  },
  achievement: {
    en: 'achievement',
    kr: '업적'
  },
  add: {
    en: 'Add',
    kr: '추가'
  },
  addAccountType: {
    en: 'Add Account Type',
    kr: '계정유형 추가'
  },
  addedBy: {
    en: 'Added by',
    kr: '게시자:'
  },
  addLink: {
    en: 'Add Link',
    kr: '링크 추가'
  },
  addMembersOfClass: {
    en: 'Add members of your class',
    kr: '멤버를 추가하세요'
  },
  addPicture: {
    en: 'Add Picture',
    kr: '사진 추가'
  },
  addQuestions: {
    en: 'Add Questions',
    kr: '문제 등록'
  },
  addEditQuestions: {
    en: 'Add/Edit Questions',
    kr: '문제 등록/수정'
  },
  addToFavorites: {
    en: 'Add to favorites',
    kr: '즐겨찾기에 추가'
  },
  addVideoToPlaylists: {
    en: 'Add Video to Playlists',
    kr: '재생목록에 추가'
  },
  advanced: {
    en: 'advanced',
    kr: '고급'
  },
  aiCards: {
    en: 'AI Cards',
    kr: 'AI 카드'
  },
  allLinks: {
    en: 'All Links',
    kr: '모든 링크'
  },
  allMissions: {
    en: 'All Missions',
    kr: '모든 미션'
  },
  aLotOfEffort: {
    en: 'A Lot of Effort',
    kr: '많은 노력'
  },
  alreadyJoined: {
    en: 'Already Joined',
    kr: '이미 가입됨'
  },
  addPlaylist: {
    en: 'Add Playlist',
    kr: '재생목록 등록'
  },
  allPlaylists: {
    en: 'All Playlists',
    kr: '모든 재생목록'
  },
  allPosts: {
    en: 'All Posts',
    kr: '모든 게시물'
  },
  allTime: {
    en: 'All Time',
    kr: '역대'
  },
  approved: {
    en: 'Approved',
    kr: '승인됨'
  },
  areYouSure: {
    en: 'Are you sure?',
    kr: '확실하신가요?'
  },
  attachContentToSubject: {
    en: 'Attach a content to your subject',
    kr: '주제에 콘텐츠 첨부'
  },
  authLevel: {
    en: 'Auth Level',
    kr: '권한 레벨'
  },
  back: {
    en: 'Back',
    kr: '뒤로가기'
  },
  basic: {
    en: 'basic',
    kr: '기본'
  },
  beFirstToLikeThisVideo: {
    en: 'Be the first to like this video',
    kr: ''
  },
  boostRewardsFromWatchingXPVideos: {
    en: 'Boost rewards from watching XP Videos',
    kr: 'XP 동영상을 볼때 얻는 XP량 증가'
  },
  by: {
    en: 'By',
    kr: '게시자:'
  },
  call: {
    en: 'Call',
    kr: '전화하기'
  },
  calling: {
    en: 'Calling',
    kr: '전화중'
  },
  cancel: {
    en: 'Cancel',
    kr: '취소'
  },
  cancelMove: {
    en: 'Cancel Move',
    kr: '되돌리기'
  },
  change: {
    en: 'Change',
    kr: '변경'
  },
  changeAccountType: {
    en: 'Change Account Type',
    kr: '계정유형 변경'
  },
  changeMyPassword: {
    en: 'Change My Password',
    kr: '비밀번호 변경'
  },
  changePassword: {
    en: 'Change your password',
    kr: '비밀번호 변경'
  },
  changePasswordDescription: {
    en: 'Change your password anytime you want. This item is free',
    kr: '비밀번호 변경은 무료로 제공됩니다'
  },
  changePic: {
    en: 'Change Pic',
    kr: '사진 변경'
  },
  changePicture: {
    en: 'Change Picture',
    kr: '사진 변경'
  },
  changeThemeMobile: {
    en: 'Theme',
    kr: '테마'
  },
  changeTheme: {
    en: 'Change theme',
    kr: '테마 변경'
  },
  changeTheme2: {
    en: 'Change Theme',
    kr: '테마 변경'
  },
  changeUsername: {
    en: 'Change your username',
    kr: '아이디 변경'
  },
  changeTopic: {
    en: 'Change Topic',
    kr: '주제 변경'
  },
  changeVideos: {
    en: 'Change Videos',
    kr: '동영상 변경'
  },
  chat: {
    en: 'Chat',
    kr: '채팅'
  },
  chat2: {
    en: 'Chat',
    kr: '채팅하기'
  },
  chess: {
    en: 'Chess',
    kr: '체스'
  },
  chessEndedInDraw: {
    en: 'The chess match ended in a draw',
    kr: '체스 게임이 무승부로 종료되었습니다'
  },
  chessWasAborted: {
    en: 'The chess match was aborted',
    kr: '체스 게임이 취소되었습니다'
  },
  choiceA: {
    en: 'Choice A',
    kr: '선택지 A'
  },
  choiceB: {
    en: 'Choice B',
    kr: '선택지 B'
  },
  choiceC: {
    en: 'Choice C (Optional)',
    kr: '선택지 C (선택사항)'
  },
  choiceD: {
    en: 'Choice D (Optional)',
    kr: '선택지 D (선택사항)'
  },
  choiceE: {
    en: 'Choice E (Optional)',
    kr: '선택지 E (선택사항)'
  },
  classroomChat: {
    en: 'Classroom',
    kr: '교실 대화방'
  },
  clear: {
    en: 'Clear',
    kr: '지우기'
  },
  close: {
    en: 'Close',
    kr: '닫기'
  },
  collected: {
    en: ' collected',
    kr: '개 수집'
  },
  collecting: {
    en: 'Collecting...',
    kr: '수집중...'
  },
  comment: {
    en: 'Comment',
    kr: '댓글'
  },
  commentedOn: {
    en: 'commented on',
    kr: '댓글을 남겼습니다'
  },
  commentOnThisVideo: {
    en: 'Comment on this video',
    kr: '댓글 달기'
  },
  commentRemoved: {
    en: 'Comment removed / no longer available',
    kr: '댓글이 존재하지 않거나 삭제되었습니다'
  },
  commentsMightNotBeRewarded: {
    en: 'The comments you post on this subject might not be rewarded',
    kr: '비밀 메시지를 조회한 다음 남기는 댓글엔 보상이 주어지지 않을 수 있습니다'
  },
  commentWasDeleted: {
    en: 'this comment was deleted',
    kr: '댓글이 삭제되었습니다'
  },
  complete: {
    en: 'Complete',
    kr: '완료'
  },
  incomplete: {
    en: 'Incomplete',
    kr: '미완료'
  },
  completed: {
    en: 'Completed',
    kr: '완료'
  },
  confirm: {
    en: 'Confirm',
    kr: '확정'
  },
  continue: {
    en: 'Continue',
    kr: '이어서'
  },
  continueWatching: {
    en: 'Continue Watching',
    kr: '이어서 시청하기'
  },
  copied: {
    en: 'Copied!',
    kr: '복사되었습니다'
  },
  copyAndPasteUrl: {
    en: 'Copy and paste a URL address here',
    kr: 'URL 주소를 복사한 후 여기에 붙여넣으세요'
  },
  create: {
    en: 'Create',
    kr: '만들기'
  },
  createMyAccount: {
    en: 'Create my account!',
    kr: '계정 생성하기'
  },
  currentMission: {
    en: 'Current Mission',
    kr: '현재 미션'
  },
  currentPassword: {
    en: 'Current Password',
    kr: '현재 비밀번호'
  },
  delete: {
    en: 'Delete',
    kr: '삭제'
  },
  deleted: {
    en: 'Deleted',
    kr: '삭제됨'
  },
  deletedBy: {
    en: 'Deleted by',
    kr: '삭제자:'
  },
  deletePermanently: {
    en: 'Delete Content Permanently',
    kr: '게시물 영구 삭제'
  },
  deletePictures: {
    en: 'Delete Pictures',
    kr: '사진 삭제'
  },
  deletedPosts: {
    en: 'Deleted Posts',
    kr: '삭제된 게시물'
  },
  doesNotHaveBio: {
    en: ' does not have a bio, yet',
    kr: '님은 아직 자기소개글이 없습니다'
  },
  done: {
    en: 'Done',
    kr: '완료'
  },
  earnXPAndKP: {
    en: 'Earn XP & KP',
    kr: 'XP와 KP 쌓기'
  },
  earnKP: {
    en: 'Earn KP',
    kr: 'KP 쌓기'
  },
  earnXP: {
    en: 'Earn XP',
    kr: 'XP 쌓기'
  },
  edit: {
    en: 'Edit',
    kr: '수정'
  },
  editBio: {
    en: 'Edit Bio',
    kr: '소개글 변경'
  },
  editGroupName: {
    en: 'Edit Group Name',
    kr: '그룹 이름 변경'
  },
  editOrDelete: {
    en: 'Edit or Delete',
    kr: '수정/삭제'
  },
  editPlaylists: {
    en: 'Edit Playlists',
    kr: '재생목록 수정'
  },
  editQuestion: {
    en: 'Edit Question',
    kr: '문제 수정'
  },
  editRewardLevel: {
    en: 'Edit Reward Level',
    kr: '보상 레벨 수정'
  },
  editTitle: {
    en: 'Edit Title',
    kr: '제목 변경'
  },
  eitherRemovedOrNeverExisted: {
    en: 'It is either removed or never existed in the first place',
    kr: '존재하지 않거나 삭제되었습니다'
  },
  elementary: {
    en: 'elementary',
    kr: '초급'
  },
  email: {
    en: 'email',
    kr: '이메일'
  },
  emailHasBeenSent: {
    en: 'An email has been sent. Tap here to check your inbox',
    kr: '이메일이 발송되었습니다. 이메일을 확인하려면 여기를 클릭하세요'
  },
  emailYoursOrYourParents: {
    en: "Email (yours or your parent's)",
    kr: '이메일 (본인 혹은 부모님의 이메일 주소를 입력하세요)'
  },
  emailIsNeededInCase: {
    en: 'Email is needed in case you forget your password',
    kr: '이메일 주소를 등록하면 비밀번호를 잊어버렸을때 계정을 되찾기 편해집니다'
  },
  enterClassName: {
    en: 'Enter the name of your class',
    kr: '교실 이름을 입력하세요'
  },
  enterComment: {
    en: 'Enter Comment',
    kr: '댓글을 입력하세요'
  },
  enterCurrentPassword: {
    en: 'Enter your current password',
    kr: '현재 사용중인 비밀번호를 입력하세요'
  },
  enterDescription: {
    en: 'Enter Description',
    kr: '소개글을 입력하세요'
  },
  enterDescriptionOptional: {
    en: "Enter Description (Optional, you don't need to write this)",
    kr: '소개글을 입력하세요 (선택사항, 입력하지 않으셔도 됩니다)'
  },
  enterDetails: {
    en: 'Enter Details',
    kr: '상세정보를 입력하세요'
  },
  enterGroupName: {
    en: 'Enter Group Name',
    kr: '그룹명을 입력하세요'
  },
  enterHeading: {
    en: 'Enter Heading',
    kr: '제목을 입력하세요'
  },
  enterMessage: {
    en: 'Enter a message',
    kr: '메시지를 입력하세요'
  },
  enterMessageForVisitors: {
    en: 'Enter a message for your visitors',
    kr: '방문자에게 전할 메시지를 입력하세요'
  },
  enterNewUsername: {
    en: 'Enter New Username',
    kr: '새로운 아이디를 입력하세요'
  },
  enterQuestion: {
    en: 'Enter Question',
    kr: '문제를 입력하세요'
  },
  enterReply: {
    en: 'Enter Reply',
    kr: '답글을 입력하세요'
  },
  enterSecretMessage: {
    en: 'Enter Secret Message',
    kr: '비밀 메시지를 입력하세요'
  },
  enterSubject: {
    en: 'Enter Subject',
    kr: '주제를 입력하세요'
  },
  enterTheUsernameYouWishToUse: {
    en: 'Enter the username you wish to use. It has to be at least 3 characters long',
    kr: '사용하고 싶은 아이디를 입력하세요. 최소 3글자 이상이어야 합니다'
  },
  enterTitle: {
    en: 'Enter Title',
    kr: '제목을 입력하세요'
  },
  enterTitleHere: {
    en: 'Enter Title Here',
    kr: '제목을 입력하세요'
  },
  enterNewPassword: {
    en: 'Enter a new password',
    kr: '새로운 비밀번호를 입력하세요'
  },
  enterUrl: {
    en: 'Enter URL',
    kr: 'URL을 입력하세요'
  },
  enterYourPassword: {
    en: 'Enter your password',
    kr: '비밀번호를 입력하세요'
  },
  enterYourUsername: {
    en: 'Enter your username',
    kr: '아이디를 입력하세요'
  },
  enterYoutubeUrl: {
    en: 'Enter YouTube URL',
    kr: '유튜브 영상의 URL 주소를 입력하세요'
  },
  epic: {
    en: 'epic',
    kr: '특급'
  },
  expandMaximumUploadSize: {
    en: 'Expand maximum upload file size',
    kr: '파일 업로드 용량 최대치 확장'
  },
  explore: {
    en: 'Explore',
    kr: '탐색'
  },
  fail: {
    en: 'Fail',
    kr: '실패'
  },
  featureContents: {
    en: 'Feature Contents',
    kr: '컨텐츠 피처링'
  },
  featuredSubjects: {
    en: 'Featured',
    kr: '고정 주제'
  },
  featuredPlaylists: {
    en: 'Featured Playlists',
    kr: '추천 재생목록'
  },
  finish: {
    en: 'Finish',
    kr: '완료'
  },
  firstName: {
    en: 'First Name',
    kr: '이름'
  },
  forEveryStarYouAdd: {
    en: 'For every star you add,the amount of XP viewers earn per minute rises.',
    kr: '별 한개를 추가할 때마다, 시청자들이 분당 얻는 XP량이 증가합니다.'
  },
  forEveryStarYouAddSubject: {
    en: 'For every star you add, the maximum amount of XP that could be rewarded to each participant of this subject rises by 2,000 XP.',
    kr: '별 한개를 추가할 때마다, 이 주제의 참가자들에게 보상 가능한 XP량이 2,000씩 증가합니다'
  },
  free: {
    en: 'Free',
    kr: '무료'
  },
  fromTwinkleWebsite: {
    en: 'from Twinkle Website',
    kr: '트윈클 웹사이트에서 가져오기'
  },
  grammarGame: {
    en: 'Grammarbles',
    kr: '문법 게임'
  },
  grammarRank: {
    en: 'Grammar Rank',
    kr: '문법게임 랭킹:'
  },
  groupName: {
    en: 'Group name',
    kr: '그룹명'
  },
  hangUp: {
    en: 'Hang Up',
    kr: '끊기'
  },
  hide: {
    en: 'Hide',
    kr: '숨기기'
  },
  hideWatched: {
    en: 'Hide Watched',
    kr: '시청한 영상 숨기기'
  },
  hiThere: {
    en: 'Hi there!',
    kr: '안녕하세요!'
  },
  home: {
    en: 'Home',
    kr: '홈'
  },
  hugeEffort: {
    en: 'Huge Effort',
    kr: '상당한 노력'
  },
  iAlreadyHaveAnAccount: {
    en: 'I already have an account',
    kr: '계정이 있으세요?'
  },
  iDontHaveAnAccount: {
    en: "I don't have an account",
    kr: '계정이 없으신가요?'
  },
  iForgotMyPassword: {
    en: 'I forgot my password',
    kr: '비밀번호를 잊어버렸습니다'
  },
  iForgotMyPassword2: {
    en: 'I forgot my password',
    kr: '비밀번호를 잊어버리셨나요?'
  },
  imageTooLarge10MB: {
    en: 'Image is too large (limit: 10mb)',
    kr: '이미지 크기가 너무 큽니다 (최대 10mb)'
  },
  incorrectPassword: {
    en: 'Incorrect password',
    kr: '비밀번호가 올바르지 않습니다'
  },
  inProgress: {
    en: 'In Progress',
    kr: '진행 중'
  },
  isNotValidUsername: {
    en: ' is not a valid username',
    kr: '는 사용 가능한 아이디가 아닙니다'
  },
  intermediate: {
    en: 'intermediate',
    kr: '중급'
  },
  invitePeople: {
    en: 'Invite People',
    kr: '멤버 초대'
  },
  joinConversation: {
    en: 'Join Conversation',
    kr: '대화 참여하기'
  },
  karmaPoints: {
    en: 'Karma Points',
    kr: '카마포인트'
  },
  label: {
    en: 'Label',
    kr: '명칭'
  },
  lastName: {
    en: 'Last Name',
    kr: '성'
  },
  lastOnline: {
    en: 'Last online',
    kr: '최근 접속:'
  },
  lastOnline2: {
    en: 'Last Online',
    kr: '최근 접속순'
  },
  leaderboard: {
    en: 'Leaderboard',
    kr: '리더보드'
  },
  leaderboards: {
    en: 'Leaderboards',
    kr: '리더보드'
  },
  leave: {
    en: 'Leave',
    kr: '나가기'
  },
  leaveChatGroup: {
    en: 'Leave Chat Group',
    kr: '대화 그룹 나가기'
  },
  leftMessageTo: {
    en: 'left a message to',
    kr: '메시지를 남겼습니다'
  },
  letsSetUpYourAccount: {
    en: `Welcome to Twinkle! Let's set up your account`,
    kr: '트윈클에 오신 것을 환영합니다! 계정을 만들어 볼까요?'
  },
  like: {
    en: 'Like',
    kr: '좋아요'
  },
  liked: {
    en: 'Liked',
    kr: '좋아요'
  },
  likes: {
    en: 'Likes',
    kr: '좋아요'
  },
  link: {
    en: 'Link',
    kr: '링크'
  },
  links: {
    en: 'Links',
    kr: '링크'
  },
  loadingTopic: {
    en: 'Loading Topic',
    kr: '주제 불러오는 중'
  },
  loadMore: {
    en: 'Load More',
    kr: '더 불러오기'
  },
  loading: {
    en: 'Loading',
    kr: '로딩중'
  },
  logIn: {
    en: 'Log In',
    kr: '로그인'
  },
  logIn2: {
    en: 'Log in',
    kr: '로그인하시고'
  },
  logMeIn: {
    en: 'Log me in!',
    kr: '로그인'
  },
  logOut: {
    en: 'Log out',
    kr: '로그아웃'
  },
  lookingUp: {
    en: 'Looking up...',
    kr: '찾는 중...'
  },
  madeByUsers: {
    en: 'Made By Twinkle Users',
    kr: '사용자 제작 콘텐츠'
  },
  madeCall: {
    en: 'made a call',
    kr: '전화를 걸었습니다'
  },
  makeSure3CharLong: {
    en: `Make sure it is at least 3 characters long`,
    kr: '3글자 이상이어야 합니다'
  },
  manage: {
    en: 'Manage',
    kr: '관리'
  },
  management: {
    en: 'Management',
    kr: '관리'
  },
  maximumUploadSize: {
    en: 'Maximum Upload File Size',
    kr: '파일 업로드 용량 최대치'
  },
  members: {
    en: 'Members',
    kr: '멤버'
  },
  memberSince: {
    en: 'Member since',
    kr: '가입일:'
  },
  menu: {
    en: 'Menu',
    kr: '메뉴'
  },
  messageBoard: {
    en: 'Message Board',
    kr: '방명록'
  },
  mission: {
    en: 'Mission',
    kr: '미션'
  },
  missionAccomplished: {
    en: 'Mission Accomplished',
    kr: '미션 완료'
  },
  missionFailed: {
    en: 'Mission Failed',
    kr: '미션 실패'
  },
  missionProgress: {
    en: 'Mission Progress',
    kr: '미션 진행률'
  },
  missions: {
    en: 'Missions',
    kr: '미션 목록'
  },
  missions2: {
    en: 'Missions',
    kr: '미션'
  },
  modActivities: {
    en: 'Mod Activities',
    kr: '관리자 활동내역'
  },
  moderators: {
    en: 'Moderators',
    kr: '관리자 목록'
  },
  moderateEffort: {
    en: 'Moderate Effort',
    kr: '적당한 노력'
  },
  monthlyXpGrowth: {
    en: 'Monthly XP Growth',
    kr: '월간 XP 증가량'
  },
  moreToCome: {
    en: 'More to come',
    kr: '출시 준비중'
  },
  myRanking: {
    en: 'My Ranking',
    kr: '내 순위'
  },
  mustLogInToViewContent: {
    en: 'You must log in to view this content',
    kr: '로그인이 필요합니다'
  },
  name: {
    en: 'Name',
    kr: '이름'
  },
  newChat: {
    en: 'New Chat',
    kr: '새로운 대화방'
  },
  newClassroomChat: {
    en: 'New Classroom',
    kr: '새로운 교실 대화방'
  },
  newGroup: {
    en: 'New Group',
    kr: '새로운 그룹'
  },
  newPassword: {
    en: 'New Password',
    kr: '새로운 비밀번호'
  },
  newPasswordMatchesCurrentPassword: {
    en: 'Your new password is the same as your current one',
    kr: '새로운 비밀번호가 현재 비밀번호와 같습니다'
  },
  newToOld: {
    en: 'New to Old',
    kr: '최신순'
  },
  news: {
    en: 'News',
    kr: '새소식'
  },
  newVideos: {
    en: 'New Videos',
    kr: '새로운 영상'
  },
  next: {
    en: 'Next',
    kr: '다음'
  },
  no: {
    en: 'No',
    kr: '아니오'
  },
  noAccountTypes: {
    en: 'No Account Types',
    kr: '계정유형 없음'
  },
  noDescription: {
    en: 'No description',
    kr: '소개글이 없습니다'
  },
  noIDontHaveAnAccount: {
    en: "No, I don't have an account",
    kr: '아니오, 계정이 없습니다'
  },
  noFeaturedSubjects: {
    en: 'No Featured Subjects',
    kr: '추천 주제가 없습니다'
  },
  notEnoughTwinkleCoins: {
    en: `You don't have enough Twinkle Coins`,
    kr: '트윈클 코인이 부족합니다'
  },
  noNewlyDeletedPosts: {
    en: 'There are no newly deleted posts',
    kr: '새로이 삭제된 게시물이 없습니다'
  },
  noLinks: {
    en: 'No Uploaded Links',
    kr: '업로드된 링크가 없습니다'
  },
  noModerators: {
    en: 'No Moderators',
    kr: '관리자가 없습니다'
  },
  noPlaylists: {
    en: 'No playlists',
    kr: '재생목록이 존재하지 않습니다'
  },
  noRankersThisMonth: {
    en: `Be the first to join this month's leaderboard by earning XP`,
    kr: 'XP를 획득하셔서 이번달 리더보드에 이름을 올리세요'
  },
  notRankedDescription: {
    en: `Earn XP by completing missions, watching XP videos, or leaving comments to join the leaderboard`,
    kr: '현재 XP가 없습니다. 미션을 완료하거나, XP 동영상을 시청하거나, 댓글을 남기시면 XP를 보상받으실 수 있습니다'
  },
  notRankedForThisMonth: {
    en: `Earn XP by completing missions, watching XP videos, or leaving comments to join this month's leaderboard`,
    kr: '이번달 랭킹이 미배정된 상태입니다. XP를 획득하시고 이번달 랭킹을 배정받으세요'
  },
  notableActivities: {
    en: 'Notable Activities',
    kr: '주요 활동'
  },
  notGainXP: {
    en: 'You earn XP only while you watch the video',
    kr: '비디오를 시청하지 않았기 때문에 XP를 획득하지 못했습니다'
  },
  noUserMadeContent: {
    en: 'No user made content',
    kr: '사용자 제작 콘텐츠가 존재하지 않습니다'
  },
  noVideosToRecommend: {
    en: "We don't have any videos to recommend to you at the moment",
    kr: '지금은 추천드릴 영상이 없습니다'
  },
  now: {
    en: 'now',
    kr: '지금'
  },
  offerDraw: {
    en: 'Offer Draw',
    kr: '무승부 제안'
  },
  offeredDraw: {
    en: 'offered a draw',
    kr: '무승부를 제안했습니다'
  },
  oldToNew: {
    en: 'Old to New',
    kr: '오래된순'
  },
  online: {
    en: 'Online',
    kr: '접속중'
  },
  optional: {
    en: '(Optional)',
    kr: '(선택사항)'
  },
  others: {
    en: ' others',
    kr: '명'
  },
  pass: {
    en: 'Pass',
    kr: '통과'
  },
  passphrase: {
    en: "Who is Big Bad Wolf's brother?",
    kr: 'Big Bad Wolf의 형의 이름은 무엇인가요?'
  },
  passphraseErrorMsg: {
    en: 'Passphrase is incorrect',
    kr: '질문에 대한 답이 올바르지 않습니다'
  },
  password: {
    en: 'Password',
    kr: '비밀번호'
  },
  passwordsNeedToBeAtLeast: {
    en: 'Passwords need to be at least 5 characters long',
    kr: '비밀번호는 5글자 이상이어야 합니다'
  },
  pending: {
    en: 'Pending',
    kr: '대기중'
  },
  people: {
    en: 'People',
    kr: '사람들'
  },
  peopleWhoLikeThisComment: {
    en: 'People who like this comment',
    kr: '이 댓글을 좋아하는 사람들'
  },
  peopleWhoLikeThisReply: {
    en: 'People who like this reply',
    kr: '이 답글을 좋아하는 사람들'
  },
  peopleWhoLikeThisVideo: {
    en: 'People who like this video',
    kr: '이 영상을 좋아하는 사람들'
  },
  perMinute: {
    en: 'per minute',
    kr: '를 1분마다 획득'
  },
  pictures: {
    en: 'Pictures',
    kr: '사진'
  },
  pin: {
    en: 'Pin',
    kr: '고정'
  },
  pinned: {
    en: 'Pinned',
    kr: '고정됨'
  },
  playlist: {
    en: 'Playlist',
    kr: '재생목록'
  },
  playlistNotExist: {
    en: 'Playlist does not exist',
    kr: '존재하지 않는 재생목록입니다'
  },
  pleaseClickDoneButtonBelow: {
    en: 'Please click the "Done" button below',
    kr: '아래의 "완료" 버튼을 눌러주세요'
  },
  pleaseEnterTitle: {
    en: 'Please enter a title',
    kr: '제목을 입력하세요'
  },
  pleaseMarkTheCorrectChoice: {
    en: 'Please mark the correct choice',
    kr: '정답을 선택해주세요'
  },
  pleaseSelectSmallerImage: {
    en: 'Please select a smaller image',
    kr: '더 작은 이미지를 선택해주세요'
  },
  pleaseVerifyEmail: {
    en: 'Please verify your email',
    kr: '이메일 주소를 인증해주세요'
  },
  post: {
    en: 'Post!',
    kr: '게시하기'
  },
  posted: {
    en: 'Posted',
    kr: ''
  },
  postPicturesOnYourProfilePage: {
    en: 'Post pictures on your profile page',
    kr: '프로필 페이지에 사진 게시'
  },
  posts: {
    en: 'Posts',
    kr: '게시물'
  },
  postSubject: {
    en: 'Post a subject users can talk about',
    kr: '대화 나누고 싶은 주제를 게시하세요'
  },
  postSubjectPlaceholder: {
    en: 'A subject users can talk about',
    kr: '무엇에 대해 이야기 나누고 싶으신가요?'
  },
  postContent: {
    en: 'Share webpages or YouTube videos',
    kr: '흥미로운 동영상이나 웹페이지를 공유하세요'
  },
  posting: {
    en: 'Posting',
    kr: '포스팅'
  },
  prev: {
    en: 'Prev',
    kr: '뒤로'
  },
  profile: {
    en: 'profile',
    kr: '프로필'
  },
  Profile: {
    en: 'Profile',
    kr: '프로필'
  },
  profilePictures: {
    en: 'Profile Pictures',
    kr: '프로필 페이지에 사진 게시'
  },
  questions: {
    en: 'Questions',
    kr: '문제'
  },
  questionTitle: {
    en: 'Question Title',
    kr: '문제'
  },
  rank: {
    en: 'Rank',
    kr: '랭킹'
  },
  ranking: {
    en: 'Ranking',
    kr: '랭킹순'
  },
  rankings: {
    en: 'Rankings',
    kr: '랭킹'
  },
  readMore: {
    en: 'Read More',
    kr: '더 읽기'
  },
  recommendation: {
    en: 'recommendation',
    kr: '추천'
  },
  recommended: {
    en: 'Recommended',
    kr: '추천'
  },
  recommendedLinks: {
    en: 'Recommended',
    kr: '추천 링크'
  },
  recommendedSubjects: {
    en: 'Recommended',
    kr: '추천 주제'
  },
  recommendedVideos: {
    en: 'Recommended',
    kr: '추천 동영상'
  },
  recommendedBy: {
    en: 'Recommended by',
    kr: '추천자:'
  },
  recommendedPosts: {
    en: 'Recommended Posts',
    kr: '추천 게시물'
  },
  recommendQ: {
    en: 'Recommend?',
    kr: '추천할까요?'
  },
  regularChat: {
    en: 'Regular Chat',
    kr: '일반 대화방'
  },
  relatedVideos: {
    en: 'Related Videos',
    kr: '연관된 영상'
  },
  rejected: {
    en: 'Rejected',
    kr: '거절됨'
  },
  remove: {
    en: 'Remove',
    kr: '삭제'
  },
  removeComment: {
    en: 'Remove',
    kr: '댓글 삭제'
  },
  removePlaylist: {
    en: 'Remove Playlist',
    kr: '재생목록 삭제'
  },
  removeReply: {
    en: 'Remove',
    kr: '답글 삭제'
  },
  reorder: {
    en: 'Reorder',
    kr: '순서 변경'
  },
  reorderPicturesByDragging: {
    en: 'Reorder Pictures by Dragging Them',
    kr: '사진을 드래그하여 순서를 변경하세요'
  },
  reorderQuestions: {
    en: 'Reorder Questions',
    kr: '문제 순서 변경'
  },
  reorderVideos: {
    en: 'Reorder Videos',
    kr: '동영상 순서 변경'
  },
  replies: {
    en: 'Replies',
    kr: '답글'
  },
  reply: {
    en: 'Reply',
    kr: '답글'
  },
  reply2: {
    en: 'Reply',
    kr: '답하기'
  },
  repliedOn: {
    en: 'replied on',
    kr: '답글을 남겼습니다'
  },
  repliedTo: {
    en: 'replied to',
    kr: '답글을 남겼습니다'
  },
  reset: {
    en: 'Reset',
    kr: '초기화'
  },
  resign: {
    en: 'Resign',
    kr: '기권하기'
  },
  abortChessMatch: {
    en: 'Abort Chess Match',
    kr: '게임취소'
  },
  resignChessMatch: {
    en: 'Resign Chess Match',
    kr: '기권하기'
  },
  respond: {
    en: 'Respond',
    kr: '댓글'
  },
  respondedTo: {
    en: 'responded to',
    kr: '댓글을 남겼습니다'
  },
  restrictAccount: {
    en: 'Restrict Account',
    kr: '계정 제한하기'
  },
  restrictedAccounts: {
    en: 'Restricted Accounts',
    kr: '제한된 계정'
  },
  retypeNewPassword: {
    en: 'Retype new password',
    kr: '새 비밀번호 재입력'
  },
  retypePasswordDoesNotMatch: {
    en: 'The passwords do not match',
    kr: '재입력 비밀번호가 일치하지 않습니다'
  },
  revoke: {
    en: 'Revoke',
    kr: '취소'
  },
  revokeReward: {
    en: 'Revoke Reward',
    kr: '보상 취소'
  },
  reward: {
    en: 'Reward',
    kr: '보상'
  },
  rewardable: {
    en: 'anyone can reward',
    kr: '보상 허용'
  },
  rewardLevel: {
    en: 'Reward Level',
    kr: '보상 레벨'
  },
  rewards: {
    en: 'Rewards',
    kr: '선물'
  },
  save: {
    en: 'Save',
    kr: '저장'
  },
  search: {
    en: 'Search',
    kr: '검색'
  },
  searchModerators: {
    en: 'Search Moderators',
    kr: '관리자 검색'
  },
  searchPlaylists: {
    en: 'Search Playlists',
    kr: '재생목록 검색'
  },
  searchUsers: {
    en: 'Search Users',
    kr: '사용자 검색'
  },
  secretMessage: {
    en: 'Secret Message',
    kr: '비밀 메시지'
  },
  select: {
    en: 'Select',
    kr: '선택'
  },
  selectVideo: {
    en: 'Select a video',
    kr: '동영상 선택'
  },
  selectWebpage: {
    en: 'Select a webpage',
    kr: '웹페이지 선택'
  },
  set: {
    en: 'Set',
    kr: '설정'
  },
  setRewardLevel: {
    en: 'Set Reward Level',
    kr: '보상 레벨 설정'
  },
  settings: {
    en: 'Settings',
    kr: '설정'
  },
  settingCannotBeChanged: {
    en: 'This setting cannot be changed',
    kr: '이 설정은 변경할 수 없습니다'
  },
  setUpPassword: {
    en: 'Password (You MUST remember your password. Write it down somewhere!)',
    kr: '비밀번호 (비밀번호는 반드시 기억해야 합니다. 어딘가에 적어두세요!)'
  },
  showAll: {
    en: 'Show All',
    kr: '전부 보기'
  },
  showMeAnotherSubject: {
    en: 'Show me another subject',
    kr: '다른 주제를 보여주세요'
  },
  showMore: {
    en: 'Show More',
    kr: '더 보기'
  },
  showMoreRewardRecords: {
    en: 'Show More Reward Records',
    kr: '더 많은 보상 기록 보기'
  },
  start: {
    en: 'Start',
    kr: '시작'
  },
  startNewChat: {
    en: 'Start a New Chat',
    kr: '새로운 채팅방 만들기'
  },
  startNewGame: {
    en: 'Start a New Game',
    kr: '새로운 게임 시작하기'
  },
  startNewSubject: {
    en: 'Start a new subject',
    kr: '새로운 주제 개설하기'
  },
  store: {
    en: 'Store',
    kr: '스토어'
  },
  stories: {
    en: 'Stories',
    kr: '스토리'
  },
  subject: {
    en: 'Subject',
    kr: '주제'
  },
  subjects: {
    en: 'Subjects',
    kr: '주제'
  },
  submit: {
    en: 'Submit',
    kr: '제출'
  },
  submit2: {
    en: 'Submit',
    kr: '등록'
  },
  submit3: {
    en: 'Submit',
    kr: '게시'
  },
  submitYourResponse: {
    en: 'Submit your response to view the secret message',
    kr: '비밀 메시지를 보려면 주제에 답하세요'
  },
  submitYourResponse2: {
    en: 'Submit your response to view this comment',
    kr: '댓글을 보려면 주제에 답하세요'
  },
  tapHere: {
    en: 'Tap Here',
    kr: '여길 누르세요'
  },
  tapToCollectRewards: {
    en: 'Tap to collect all your rewards',
    kr: '모든 선물을 받으시려면 탭하세요'
  },
  task: {
    en: 'task',
    kr: '과제'
  },
  taskComplete: {
    en: 'Task Complete',
    kr: '과제 완료'
  },
  tapThisButtonToSubmit: {
    en: 'Tap this button to submit',
    kr: '이 버튼을 누르면 게시됩니다'
  },
  thereAreNoQuestions: {
    en: 'There are no questions, yet',
    kr: '등록된 문제가 없습니다'
  },
  thereMustBeAtLeastTwoChoices: {
    en: 'There must be at least two choices',
    kr: '최소 두 개의 선택지를 입력해주세요'
  },
  thisMonth: {
    en: 'This Month',
    kr: '이번 달'
  },
  toAccessAllFeatures: {
    en: 'to access all features',
    kr: '모든 기능에 액세스하세요'
  },
  top30: {
    en: 'Top 30',
    kr: '톱 30'
  },
  typeWord: {
    en: 'Type a word...',
    kr: '단어를 입력하세요...'
  },
  typeWordInBoxBelow: {
    en: 'Type a word in the text box below',
    kr: '아래의 입력란에 단어를 입력하세요'
  },
  undo: {
    en: 'Undo',
    kr: '실행취소'
  },
  unpin: {
    en: 'Unpin',
    kr: '고정해제'
  },
  unranked: {
    en: 'Unranked',
    kr: '랭킹없음'
  },
  untitledQuestion: {
    en: 'Untitled Question',
    kr: '문제'
  },
  uploadedBy: {
    en: 'Uploaded by',
    kr: '게시자:'
  },
  upNext: {
    en: 'Up Next',
    kr: '다음 영상'
  },
  user: {
    en: 'User',
    kr: '사용자'
  },
  userEmailNotVerified: {
    en: `This user's email has not been verified, yet`,
    kr: '이 사용자의 이메일 주소는 아직 인증되지 않았습니다'
  },
  username: {
    en: 'Username',
    kr: '아이디'
  },
  usernameAlreadyTaken: {
    en: `That username is already taken`,
    kr: '이미 사용중인 아이디입니다'
  },
  usernameAvailable: {
    en: `This username is available`,
    kr: '사용 가능한 아이디입니다'
  },
  users: {
    en: 'Users',
    kr: '사용자'
  },
  video: {
    en: 'Video',
    kr: '동영상'
  },
  videos: {
    en: 'Videos',
    kr: '동영상 목록'
  },
  videos2: {
    en: 'Videos',
    kr: '동영상'
  },
  viewProfile: {
    en: 'View Profile',
    kr: '프로필'
  },
  viewSecretMessageWithoutResponding: {
    en: 'View secret message without responding',
    kr: '비밀 메시지 보기'
  },
  viewWithoutResponding: {
    en: 'View without responding',
    kr: '비밀 메시지 보기'
  },
  visitWebsite: {
    en: 'Visit Website',
    kr: '웹사이트'
  },
  visitYoutube: {
    en: 'Visit YouTube',
    kr: '유튜브'
  },
  vocabulary: {
    en: 'Vocabulary',
    kr: '단어수집 게임'
  },
  watched: {
    en: 'Watched',
    kr: '시청한 영상'
  },
  watching: {
    en: 'watching',
    kr: '시청하기'
  },
  wasLastActive: {
    en: 'Was last active',
    kr: '최근 접속:'
  },
  website: {
    en: 'website',
    kr: '웹사이트'
  },
  Website: {
    en: 'Website',
    kr: '웹사이트'
  },
  welcomeToTwinkle: {
    en: `Welcome to Twinkle. Do you have a Twinkle account?`,
    kr: '트윈클에 오신 것을 환영합니다. 계정이 있으신가요?'
  },
  whatIsYourFirstName: {
    en: 'What is your first name?',
    kr: '이름을 입력하세요'
  },
  whatIsYourLastName: {
    en: 'What is your last name?',
    kr: '성을 입력하세요'
  },
  whenReadyPressStart: {
    en: 'When you are ready, press "Start"',
    kr: '준비되시면 시작 버튼을 누르세요'
  },
  xpAnalysis: {
    en: 'XP Analysis',
    kr: 'XP 분석'
  },
  xpAcquisition: {
    en: 'XP Acquisition',
    kr: 'XP 획득처'
  },
  xpVideos: {
    en: 'XP Videos',
    kr: 'XP 동영상'
  },
  yes: {
    en: 'Yes',
    kr: '예'
  },
  yesIHaveAnAccount: {
    en: 'Yes, I have an account',
    kr: '예, 계정이 있습니다'
  },
  you: {
    en: 'you',
    kr: '회원님'
  },
  You: {
    en: 'You',
    kr: '회원님'
  },
  youCanChangeThisSettingLater: {
    en: 'You can change this setting later',
    kr: '나중에 언제든지 이 설정을 변경하실 수 있습니다'
  },
  yourUsernameAndPassword: {
    en: `What's your username and password?`,
    kr: '아이디와 비밀번호를 입력하세요'
  },
  yourTwinkleCoins: {
    en: 'Your Twinkle Coins',
    kr: '코인'
  },
  yourXP: {
    en: 'Your XP',
    kr: 'XP'
  },
  youtube: {
    en: 'YouTube',
    kr: '유튜브'
  },
  youtubeVideo: {
    en: 'YouTube Video',
    kr: '유튜브 동영상'
  }
};

export default function localize(section: string): string {
  return languageObj?.[section]?.[SELECTED_LANGUAGE] || '';
}
