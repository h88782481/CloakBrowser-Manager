import { exact } from "./zh-CN";

/** Translate one user-visible message. Unknown text is returned unchanged. */
export function translateText(message: string): string {
  const known = exact[message];
  if (known !== undefined) return known;

  if (/session limit reached/i.test(message)) {
    return "已达到当前许可证允许的同时在线数上限";
  }
  if (/^Invalid proxy scheme '.+'\. Must be http, https, or socks5\.$/.test(message)) {
    return "代理协议无效。只能使用 http、https 或 socks5。";
  }
  if (/^Proxy URL missing hostname: /.test(message)) return "代理地址缺少主机名";
  if (/^Proxy URL missing port: /.test(message)) return "代理地址缺少端口";
  if (/^Proxy URL has invalid port: /.test(message)) return "代理地址端口无效";
  if (/^Invalid proxy URL: /.test(message)) return "代理地址格式无效";
  const invalidLine = /^Invalid proxy address on line (\d+)$/.exec(message);
  if (invalidLine) return `第 ${invalidLine[1]} 行的代理地址无效，请检查协议、主机和端口。`;
  if (/^Manager owns remote debugging configuration; remove: /.test(message)) {
    return "远程调试参数由管理器占用，请从高级启动参数里移除相关项";
  }
  if (/^Profile .+ is busy: its browser state is being copied or reset$/.test(message)) {
    return "该配置正忙：正在复制或重置浏览器状态";
  }
  if (/^Profile .+ is still closing; retry shortly$/.test(message)) {
    return "该配置仍在关闭，请稍后再试";
  }
  if (/^Profile .+ is already running$/.test(message)) return "该配置已在运行";
  if (/^Unable to start verified CDP for profile /.test(message)) return "无法为该配置启动调试端口";
  if (/^Browser startup did not complete for profile /.test(message)) {
    return "该配置的浏览器没有完成启动";
  }
  if (/^upload exceeds \d+ bytes$/.test(message)) return "文件超过单文件大小上限";
  if (/^profile already holds \d+ artifacts \(max \d+\)$/.test(message)) {
    return "该配置的文件数量已达上限";
  }
  if (/^profile artifact storage would reach \d+ bytes \(max \d+\)$/.test(message)) {
    return "该配置的文件总大小会超过上限";
  }
  if (/^Failed to store upload: /.test(message)) return "保存上传文件失败";
  if (/^Failed to record upload: /.test(message)) return "记录上传文件失败";
  if (/^Failed to copy browser state: /.test(message)) return "复制浏览器状态失败";
  return message;
}
