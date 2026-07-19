import { h, type Component } from 'vue';
import { NIcon } from 'naive-ui';
import {
  HomeOutline,
  FolderOutline,
  MailOutline,
  ListOutline,
  SettingsOutline,
  MenuOutline,
  CloseOutline,
  NotificationsOutline,
  GitNetworkOutline,
  TimeOutline,
  DocumentTextOutline,
  FlashOutline,
  ShieldCheckmarkOutline,
  CloudUploadOutline,
  CodeSlashOutline,
  RocketOutline,
  LinkOutline,
  AlarmOutline,
  LayersOutline,
  KeyOutline,
  PersonOutline,
  DownloadOutline,
  CloudDownloadOutline,
  ArrowForwardOutline,
  CheckmarkCircleOutline,
  AlertCircleOutline,
  HourglassOutline,
  PaperPlaneOutline,
  ServerOutline,
  HardwareChipOutline,
  ChatbubbleEllipsesOutline,
  SendOutline,
} from '@vicons/ionicons5';

/** 统一线性图标渲染 */
export function renderIcon(icon: Component, size = 18, color?: string) {
  return () =>
    h(
      NIcon,
      { size, color, component: icon },
      { default: () => h(icon) },
    );
}

export const Icons = {
  home: HomeOutline,
  folder: FolderOutline,
  mail: MailOutline,
  list: ListOutline,
  settings: SettingsOutline,
  menu: MenuOutline,
  close: CloseOutline,
  bell: NotificationsOutline,
  network: GitNetworkOutline,
  time: TimeOutline,
  document: DocumentTextOutline,
  flash: FlashOutline,
  shield: ShieldCheckmarkOutline,
  upload: CloudUploadOutline,
  code: CodeSlashOutline,
  rocket: RocketOutline,
  link: LinkOutline,
  alarm: AlarmOutline,
  layers: LayersOutline,
  key: KeyOutline,
  person: PersonOutline,
  download: DownloadOutline,
  cloudDownload: CloudDownloadOutline,
  arrowForward: ArrowForwardOutline,
  success: CheckmarkCircleOutline,
  error: AlertCircleOutline,
  pending: HourglassOutline,
  plane: PaperPlaneOutline,
  server: ServerOutline,
  chip: HardwareChipOutline,
  chat: ChatbubbleEllipsesOutline,
  send: SendOutline,
} as const;

export type IconName = keyof typeof Icons;
