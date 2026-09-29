export type SimId = "work" | "home";
export type Delivery = "processing" | "sent" | "unknown";
export type Message = {
  id: string;
  text: string;
  time: string;
  outgoing?: boolean;
  status?: Delivery;
};
export type Conversation = {
  id: string;
  sender: string;
  sim: SimId;
  unread: boolean;
  code?: string;
  reply: boolean;
  messages: Message[];
};
export const sims = {
  work: { name: "工作卡", tail: "2468" },
  home: { name: "国内卡", tail: "8890" },
};
export const initialConversations: Conversation[] = [
  {
    id: "dbs",
    sender: "DBS",
    sim: "work",
    unread: true,
    code: "381492",
    reply: false,
    messages: [
      {
        id: "d1",
        text: "您的验证码为 381492，请勿向他人透露。若非本人操作，请忽略此短信。",
        time: "21:18",
      },
    ],
  },
  {
    id: "meeting",
    sender: "+65 8123 4567",
    sim: "work",
    unread: true,
    reply: true,
    messages: [
      { id: "m1", text: "明天下午三点见，方便吗？", time: "21:10" },
      {
        id: "m2",
        text: "可以，我们在楼下见。",
        time: "21:12",
        outgoing: true,
        status: "sent",
      },
      { id: "m3", text: "好的，到了联系你。", time: "21:18" },
    ],
  },
  {
    id: "github",
    sender: "GitHub",
    sim: "work",
    unread: false,
    code: "624819",
    reply: false,
    messages: [
      {
        id: "g1",
        text: "Your authentication code is 624819. Do not share this code with anyone.",
        time: "18:30",
      },
    ],
  },
  {
    id: "parcel",
    sender: "快递通知",
    sim: "work",
    unread: false,
    reply: false,
    messages: [
      {
        id: "p1",
        text: "您的包裹已送达取件点，请凭取件通知领取。感谢您的使用。",
        time: "16:12",
      },
    ],
  },
  {
    id: "mobile",
    sender: "中国移动",
    sim: "home",
    unread: true,
    reply: false,
    messages: [
      {
        id: "c1",
        text: "您本月剩余通用流量 12.8 GB。详情请通过运营商官方渠道查询。",
        time: "15:46",
      },
    ],
  },
  {
    id: "home-friend",
    sender: "+86 138 0013 8000",
    sim: "home",
    unread: false,
    reply: true,
    messages: [{ id: "h1", text: "周末一起吃饭吧。", time: "12:30" }],
  },
];
export function filterConversations(
  items: Conversation[],
  sim: SimId | "all",
  unread: boolean,
) {
  return items.filter(
    (c) => (sim === "all" || c.sim === sim) && (!unread || c.unread),
  );
}
export function validRecipient(value: string) {
  return /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s()-]/g, ""));
}
export function deliveryLabel(status?: Delivery) {
  return status === "processing"
    ? "正在发送"
    : status === "unknown"
      ? "结果未确认，可能已发出"
      : "已发送 · 暂无送达报告";
}
export function canSubmit(text: string, online: boolean, busy: boolean) {
  return text.trim().length > 0 && online && !busy;
}
