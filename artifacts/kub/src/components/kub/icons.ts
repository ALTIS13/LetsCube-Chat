import {
  ArrowBendUpLeft,
  ArrowBendUpRight,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowSquareOut,
  At,
  Bell,
  BellSlash,
  Robot,
  Key,
  WebhooksLogo,
  BookmarkSimple,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChartBarHorizontal,
  ChatCircle,
  ChatsCircle,
  ChatText,
  Check,
  CheckCircle,
  Checks,
  CircleNotch,
  ClipboardText,
  Clock,
  Cloud,
  Copy,
  Crown,
  DotsThreeVertical,
  DownloadSimple,
  Envelope,
  Eye,
  EyeSlash,
  AirplaneTilt,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FunnelSimple,
  FolderPlus,
  ForkKnife,
  GearSix,
  HandWaving,
  Hash,
  Heart,
  IdentificationBadge,
  Image as ImageIcon,
  Info,
  Lightning,
  LinkSimple,
  List,
  ListChecks,
  Lock,
  MagnifyingGlass,
  MapPin,
  Microphone,
  MicrophoneSlash,
  Monitor,
  Moon,
  MusicNotes,
  PaperPlaneRight,
  PaperPlaneTilt,
  Paperclip,
  PawPrint,
  Pause,
  PencilSimple,
  Phone,
  Play,
  Plus,
  Prohibit,
  Pulse,
  PushPin,
  PushPinSlash,
  Question,
  SealCheck,
  Shield,
  ShieldCheck,
  ShieldSlash,
  SignOut,
  Smiley,
  SoccerBall,
  SpeakerHigh,
  SpeakerSlash,
  SquaresFour,
  Sun,
  Trash,
  User,
  UserCircle,
  UserGear,
  UserMinus,
  UserPlus,
  UsersThree,
  VideoCamera,
  Warning,
  WarningCircle,
  Waveform,
  X,
  XCircle,
  type Icon as PhosphorIcon,
  type IconWeight,
} from "@phosphor-icons/react";

export type KubIconName =
  | "activity"
  | "admin"
  | "airplane"
  | "alert"
  | "atSign"
  | "attach"
  | "audit"
  | "back"
  | "ban"
  | "bookmark"
  | "bot"
  | "camera"
  | "channel"
  | "chatBubble"
  | "chatRect"
  | "chats"
  | "check"
  | "checkCircle"
  | "checklist"
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "chevronUp"
  | "clock"
  | "close"
  | "cloud"
  | "contact"
  | "copy"
  | "create"
  | "crown"
  | "dashboard"
  | "delete"
  | "doubleCheck"
  | "download"
  | "edit"
  | "externalLink"
  | "eye"
  | "eyeOff"
  | "file"
  | "filter"
  | "folder"
  | "folderAdd"
  | "folderOpen"
  | "food"
  | "forward"
  | "gesture"
  | "group"
  | "hash"
  | "heart"
  | "help"
  | "image"
  | "imageOriginal"
  | "info"
  | "key"
  | "link"
  | "lock"
  | "logout"
  | "mail"
  | "mailCheck"
  | "manager"
  | "mapPin"
  | "menu"
  | "microphone"
  | "microphoneSlash"
  | "more"
  | "music"
  | "muted"
  | "notifications"
  | "notificationsOff"
  | "pause"
  | "paw"
  | "phone"
  | "pin"
  | "pinOff"
  | "play"
  | "poll"
  | "private"
  | "profile"
  | "reject"
  | "reply"
  | "rotate"
  | "search"
  | "send"
  | "settings"
  | "shield"
  | "shieldOff"
  | "smile"
  | "spinner"
  | "sport"
  | "tasks"
  | "themeDark"
  | "themeLight"
  | "themeSystem"
  | "unban"
  | "user"
  | "userCog"
  | "userRemove"
  | "userPlus"
  | "users"
  | "verified"
  | "video"
  | "voice"
  | "volume"
  | "warning"
  | "webhook"
  | "zap";

interface IconEntry {
  Icon: PhosphorIcon;
  /** Default weight for this icon. */
  weight?: IconWeight;
}

/**
 * Single source of truth for LETSCUBE UI icons.
 * Use semantic names so screens never reach for low-level Phosphor names.
 */
export const KUB_ICONS: Record<KubIconName, IconEntry> = {
  activity: { Icon: Pulse },
  admin: { Icon: ShieldCheck },
  airplane: { Icon: AirplaneTilt },
  alert: { Icon: WarningCircle },
  atSign: { Icon: At },
  attach: { Icon: Paperclip },
  audit: { Icon: ListChecks },
  back: { Icon: ArrowLeft },
  ban: { Icon: Prohibit },
  bookmark: { Icon: BookmarkSimple },
  bot: { Icon: Robot },
  camera: { Icon: Camera },
  channel: { Icon: Hash },
  chatBubble: { Icon: ChatCircle },
  chatRect: { Icon: ChatText },
  chats: { Icon: ChatsCircle },
  check: { Icon: Check },
  checkCircle: { Icon: CheckCircle },
  // A list of tasks as a message, Telegram's «Список».
  checklist: { Icon: ListChecks },
  chevronDown: { Icon: CaretDown },
  chevronLeft: { Icon: CaretLeft },
  chevronRight: { Icon: CaretRight },
  chevronUp: { Icon: CaretUp },
  clock: { Icon: Clock },
  close: { Icon: X },
  cloud: { Icon: Cloud },
  // A person's card sent into a chat, Telegram's «Контакт».
  contact: { Icon: UserCircle },
  copy: { Icon: Copy },
  create: { Icon: Plus },
  crown: { Icon: Crown, weight: "fill" },
  dashboard: { Icon: SquaresFour },
  delete: { Icon: Trash },
  doubleCheck: { Icon: Checks },
  download: { Icon: DownloadSimple },
  edit: { Icon: PencilSimple },
  externalLink: { Icon: ArrowSquareOut },
  eye: { Icon: Eye },
  eyeOff: { Icon: EyeSlash },
  file: { Icon: FileText },
  filter: { Icon: FunnelSimple },
  folder: { Icon: Folder },
  folderAdd: { Icon: FolderPlus },
  folderOpen: { Icon: FolderOpen },
  food: { Icon: ForkKnife },
  forward: { Icon: PaperPlaneRight },
  gesture: { Icon: HandWaving },
  group: { Icon: UsersThree },
  hash: { Icon: Hash },
  heart: { Icon: Heart },
  help: { Icon: Question },
  image: { Icon: ImageIcon },
  // A photo as a file: sent as it is, without compression.
  imageOriginal: { Icon: FileImage },
  info: { Icon: Info },
  key: { Icon: Key },
  link: { Icon: LinkSimple },
  lock: { Icon: Lock },
  logout: { Icon: SignOut },
  mail: { Icon: Envelope },
  mailCheck: { Icon: CheckCircle },
  manager: { Icon: IdentificationBadge },
  mapPin: { Icon: MapPin },
  menu: { Icon: List },
  microphone: { Icon: Microphone },
  microphoneSlash: { Icon: MicrophoneSlash },
  more: { Icon: DotsThreeVertical },
  music: { Icon: MusicNotes },
  muted: { Icon: SpeakerSlash },
  notifications: { Icon: Bell },
  notificationsOff: { Icon: BellSlash },
  pause: { Icon: Pause, weight: "fill" },
  paw: { Icon: PawPrint },
  phone: { Icon: Phone },
  pin: { Icon: PushPin, weight: "fill" },
  pinOff: { Icon: PushPinSlash },
  play: { Icon: Play, weight: "fill" },
  // Telegram's glyph for a poll: answers as bars.
  poll: { Icon: ChartBarHorizontal },
  private: { Icon: UserCircle },
  profile: { Icon: UserCircle },
  reject: { Icon: XCircle },
  reply: { Icon: ArrowBendUpLeft },
  rotate: { Icon: ArrowCounterClockwise },
  search: { Icon: MagnifyingGlass },
  send: { Icon: PaperPlaneTilt, weight: "fill" },
  settings: { Icon: GearSix },
  shield: { Icon: Shield },
  shieldOff: { Icon: ShieldSlash },
  smile: { Icon: Smiley },
  spinner: { Icon: CircleNotch },
  sport: { Icon: SoccerBall },
  tasks: { Icon: ClipboardText },
  themeDark: { Icon: Moon },
  themeLight: { Icon: Sun },
  themeSystem: { Icon: Monitor },
  unban: { Icon: ShieldCheck },
  user: { Icon: User },
  userCog: { Icon: UserGear },
  userRemove: { Icon: UserMinus },
  userPlus: { Icon: UserPlus },
  users: { Icon: UsersThree },
  verified: { Icon: SealCheck, weight: "fill" },
  video: { Icon: VideoCamera },
  voice: { Icon: Waveform },
  volume: { Icon: SpeakerHigh },
  warning: { Icon: Warning },
  webhook: { Icon: WebhooksLogo },
  zap: { Icon: Lightning, weight: "fill" },
};
