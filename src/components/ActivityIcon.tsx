import SvgArrowReply from '@/svg_components/ArrowReply';
import SvgAtSign from '@/svg_components/AtSign';
import SvgComment from '@/svg_components/Comment';
import SvgHeart from '@/svg_components/Heart';
import SvgProfile from '@/svg_components/Profile';
import SvgBullhorn from '@/svg_components/Bullhorn';
import SvgCalendar from '@/svg_components/Calendar';
import SvgCheckCircle from '@/svg_components/CheckCircle';
import SvgNotificationBell from '@/svg_components/NotificationBell';
import { ActivityType } from '@/generated/prisma/client';

function CreateFollowNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-pink-400 to-red-500 p-2">
      <SvgProfile width={18} height={18} stroke="white" />
    </div>
  );
}
function LikeNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-sky-400 to-sky-500 p-2">
      <SvgHeart width={18} height={18} stroke="white" />
    </div>
  );
}
function MentionNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 p-2">
      <SvgAtSign width={18} height={18} stroke="white" />
    </div>
  );
}
function CreateCommentNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-blue-400 to-blue-500 p-2">
      <SvgComment width={18} height={18} stroke="white" />
    </div>
  );
}
function CreateReplyNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-blue-400 to-blue-500 p-2">
      <SvgArrowReply width={18} height={18} stroke="white" />
    </div>
  );
}
function CampaignJoinNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-sky-400 to-sky-600 p-2">
      <SvgBullhorn width={18} height={18} stroke="white" />
    </div>
  );
}
function ActionRSVPNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-cyan-400 to-cyan-600 p-2">
      <SvgCalendar width={18} height={18} stroke="white" />
    </div>
  );
}
function ActionCompletedNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 p-2">
      <SvgCheckCircle width={18} height={18} stroke="white" />
    </div>
  );
}
function ActionReminderNotificationIcon() {
  return (
    <div className="absolute -bottom-2 right-0 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 p-2">
      <SvgNotificationBell width={18} height={18} stroke="white" />
    </div>
  );
}

const ActivityIcons: Record<ActivityType, () => JSX.Element> = {
  CREATE_FOLLOW: () => <CreateFollowNotificationIcon />,

  POST_LIKE: () => <LikeNotificationIcon />,
  POST_MENTION: () => <MentionNotificationIcon />,

  CREATE_COMMENT: () => <CreateCommentNotificationIcon />,
  COMMENT_LIKE: () => <LikeNotificationIcon />,
  COMMENT_MENTION: () => <MentionNotificationIcon />,

  CREATE_REPLY: () => <CreateReplyNotificationIcon />,
  REPLY_LIKE: () => <LikeNotificationIcon />,
  REPLY_MENTION: () => <MentionNotificationIcon />,

  // Campaign activity types
  CAMPAIGN_JOIN: () => <CampaignJoinNotificationIcon />,
  ACTION_RSVP: () => <ActionRSVPNotificationIcon />,
  ACTION_COMPLETED: () => <ActionCompletedNotificationIcon />,
  ACTION_REMINDER: () => <ActionReminderNotificationIcon />,
};

export function ActivityIcon({ type }: { type: ActivityType }) {
  return <>{ActivityIcons[type]()}</>;
}
