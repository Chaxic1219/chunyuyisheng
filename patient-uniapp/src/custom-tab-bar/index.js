Component({
  data: {
    selected: 0,
    elder: false,
    reducedMotion: false,
    color: "#89948E",
    selectedColor: "#176B52",
    list: [
      {
        pagePath: "/pages/index/index",
        text: "首页",
        iconPath: "/static/tab/home.png",
        selectedIconPath: "/static/tab/home-active.png",
      },
      {
        pagePath: "/pages/consult/index",
        text: "咨询",
        iconPath: "/static/tab/chat.png",
        selectedIconPath: "/static/tab/chat-active.png",
      },
      {
        pagePath: "/pages/mine/index",
        text: "我的",
        iconPath: "/static/tab/user.png",
        selectedIconPath: "/static/tab/user-active.png",
      },
    ],
  },
  methods: {
    onSwitch(event) {
      const { index, path } = event.currentTarget.dataset;
      const next = Number(index);
      this.setData({ selected: next });
      wx.switchTab({ url: path });
    },
  },
});
