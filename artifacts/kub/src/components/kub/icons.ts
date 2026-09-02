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
  Envelope,
  Eye,
  EyeSlash,
  FileText,
  Folder,
  FolderOpen,
  FunnelSimple,
  FolderPlus,
  GearSix,
  Hash,
  IdentificationBadge,
  Image as ImageIcon,
  Info,
  Lightning,
  List,
  ListChecks,
  Lock,
  MagnifyingGlass,
  MapPin,
  Microphone,
  MicrophoneSlash,
  Monitor,
  Moon,
  PaperPlaneRight,
  PaperPlaneTilt,
  Paperclip,
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
  | "chevronDown"
  | "chevronLeft"
  | "chevronRight"
  | "chevronUp"
  | "clock"
  | "close"
  | "cloud"
  | "copy"
  | "create"
  | "crown"
  | "dashboard"
  | "delete"
  | "doubleCheck"
  | "edit"
  | "externalLink"
  | "eye"
  | "eyeOff"
  | "file"
  | "filter"
  | "folder"
  | "folderAdd"
  | "folderOpen"
  | "forward"
  | "group"
  | "hash"
  | "help"
  | "image"
  | "info"
  | "key"
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
  | "muted"
  | "notifications"
  | "notificationsOff"
  | "pause"
  | "phone"
  | "pin"
  | "pinOff"
  | "play"
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
  chevronDown: { Icon: CaretDown },
  chevronLeft: { Icon: CaretLeft },
  chevronRight: { Icon: CaretRight },
  chevronUp: { Icon: CaretUp },
  clock: { Icon: Clock },
  close: { Icon: X },
  cloud: { Icon: Cloud },
  copy: { Icon: Copy },
  create: { Icon: Plus },
  crown: { Icon: Crown, weight: "fill" },
  dashboard: { Icon: SquaresFour },
  delete: { Icon: Trash },
  doubleCheck: { Icon: Checks },
  edit: { Icon: PencilSimple },
  externalLink: { Icon: ArrowSquareOut },
  eye: { Icon: Eye },
  eyeOff: { Icon: EyeSlash },
  file: { Icon: FileText },
  filter: { Icon: FunnelSimple },
  folder: { Icon: Folder },
  folderAdd: { Icon: FolderPlus },
  folderOpen: { Icon: FolderOpen },
  forward: { Icon: PaperPlaneRight },
  group: { Icon: UsersThree },
  hash: { Icon: Hash },
  help: { Icon: Question },
  image: { Icon: ImageIcon },
  info: { Icon: Info },
  key: { Icon: Key },
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
  muted: { Icon: SpeakerSlash },
  notifications: { Icon: Bell },
  notificationsOff: { Icon: BellSlash },
  pause: { Icon: Pause, weight: "fill" },
  phone: { Icon: Phone },
  pin: { Icon: PushPin, weight: "fill" },
  pinOff: { Icon: PushPinSlash },
  play: { Icon: Play, weight: "fill" },
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
