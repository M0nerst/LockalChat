import { avatarColor, initials } from "../utils/avatar.js";

interface AvatarProps {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
}

export function Avatar({ id, name, size = 44, online }: AvatarProps) {
  return (
    <div className="avatar-wrap" style={{ width: size, height: size }}>
      <div
        className="avatar"
        style={{ background: avatarColor(id), width: size, height: size, fontSize: size * 0.4 }}
      >
        {initials(name)}
      </div>
      {online !== undefined && (
        <span className={`avatar-status ${online ? "online" : "offline"}`} />
      )}
    </div>
  );
}
