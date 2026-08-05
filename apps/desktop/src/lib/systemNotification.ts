import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export interface PermissionNotificationInput {
  action: string;
  resources: string[];
}

function permissionBody(input: PermissionNotificationInput): string {
  const firstResource = input.resources[0];
  return firstResource ? `${input.action}\n${firstResource}` : input.action;
}

export async function notifyPermissionRequest(input: PermissionNotificationInput): Promise<boolean> {
  let granted = await isPermissionGranted();
  if (!granted) {
    granted = (await requestPermission()) === "granted";
  }
  if (!granted) return false;

  try {
    sendNotification({
      title: "FormuLab needs your approval",
      body: permissionBody(input),
    });
    return true;
  } catch {
    return false;
  }
}

/** A failed automatic backup surfaces here rather than only as an in-app
 *  toast — an automatic backup can fail while the window isn't focused
 *  (a daily/weekly tick, or a backup-on-exit run just before the window
 *  closes), where a toast would never be seen. Never requests permission
 *  proactively for this — if the user hasn't already granted it (e.g. via
 *  an earlier approval-request notification), this silently does nothing
 *  rather than interrupting a quiet failure with a permission prompt. */
export async function notifyAutomaticBackupFailure(className: string, message: string): Promise<boolean> {
  const granted = await isPermissionGranted();
  if (!granted) return false;

  try {
    sendNotification({
      title: "FormuLab automatic backup failed",
      body: `${className}: ${message}`,
    });
    return true;
  } catch {
    return false;
  }
}
