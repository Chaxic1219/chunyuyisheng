# 页面替换总结

本总结按当前静态模板与已确认的“风格 B 纯线性、动效 B 状态引导、全部可点击控件、语义系统化”决策编制。逐项定位见 `interaction-inventory.csv`。

命名口径：正文中的图标名均为基础 semantic；`interaction-inventory.csv` 的 `tone` 列是 87 个具体模板的权威色调来源，只允许 `primary`、`inverse`、`muted`、`danger`，且不拼进 semantic。运行时文件名才按 `<semantic>.png`、`<semantic>-inverse.png`、`<semantic>-muted.png`、`<semantic>-danger.png` 生成。多语义或运行时未知模板先记 `primary`，并在 notes 中要求调用方按实际动作或 variant 覆盖。

## 首页（P1，服务相关入口按 P0）

- 提醒入口：`clock` → `reminder`。
- 去完善、上传档案、手动创建：分别使用 `profile-edit`、`upload-record`、`action-create`。
- 下一任务、查看计划、待确认档案：分别使用 `task-next`、`health-plan`、`health-record`。
- 快捷入口按 key 固定为 `upload-record`、`medication`、`consult-doctor`、`metric-record`、`follow-up`、`service-package`；“问用药”和“直接咨询”不得继续共用 `quick-med`。
- 服务进度与推荐商品使用 `service-detail`；开通动作使用 `service-activate`。运行时异常文案无法静态确定时先使用 `action-unknown`，待数据层明确语义后替换。

## 咨询（P1）

- 清空、快捷问题、失败重试、发送：`action-clear`、`quick-question`、`action-refresh`、`action-send`。
- 发送中切换 `status-loading` 并禁止重复点击；失败显示基础语义 `status-error`（tone：`danger`），动作仍是 `action-refresh`。
- 原生发送按钮保留现有事件与禁用逻辑，补图标和 `aria-label`。

## 档案（P1）

- 绑定、生成计划、完善、确认、查看、更新：`record-bind`、`plan-create`、`record-edit/profile-edit`、`action-confirm`、`health-record`、`action-update`。
- 分类卡和列表统一为健康记录语义；服务端未知图标先过别名注册表，无法确认时使用 `action-unknown`，不得回退 `help`。
- 所有重新加载使用 `action-refresh`；返回查看使用 `nav-back`。

## 计划（P1）

- 下一任务/去完成：`task-next`；已完成：`status-success`；查看计划：`health-plan`。
- `health` 用药入口改为 `medication`；`chat` 计划咨询改为 `plan-consult`。
- 任务 v-for 是一个模板入口但运行时多实例，按钮状态需防重复提交。

## 服务包（P0）

- 分类固定为 `health-plan`、`medication`、`follow-up`、`rehab-guide`、`postop-assessment`、`consult-doctor`、`goods-order`、`service-rights`。
- 商品卡查看详情使用 `service-detail`，开通使用 `service-activate`；不得让服务包、服务中心、健康助手继续共用 `shield`。
- 我的服务记录使用 `health-record`；失败重试使用 `action-refresh`；“需要帮助选择”是咨询动作，使用 `consult-doctor`。
- 详情页“返回健康服务”使用 `nav-back`。

## 我的（P2；档案入口 P1）

- 健康资产：`health-record`、`health-plan`、`health-log`、`member-record`。
- 服务资产：`service-center`、`order`、`service-rights`、`privacy`、`data-export`。
- 设置与长辈模式：`settings`、`elder-mode`；头像更换使用 `camera`。
- `view-archive-btn.png` 文字栅格按钮必须删除，改为真实文本“查看档案”+ `health-record`。

## 设置（P2）

- 授权与共享：`privacy`、`group-service`、`permission-scope`。
- 账号安全、手机号：`account-security`、`phone-bind`。
- 退出、微信解绑：基础语义 `account-logout`、`wechat-unbind`，两者 tone 均为 `danger`，保留二次确认且不摇晃。
- 导出、删除：基础语义 `data-export`、`data-delete`；删除使用 tone `danger`，禁止继续共用 `asset-data`。
- 增加“减少动态效果”入口，使用 `settings`，保留颜色与状态反馈并关闭位移/缩放。

## 家庭（P2）

- 成员进入、授权范围、代操作记录：`member-record`、`permission-scope`、`health-record`。
- 撤销授权使用基础语义 `action-close`（tone：`danger`）并二次确认，不使用 `help`。
- 添加成员使用 `member-add`。

## 认证 / 表单（P2）

- 微信登录、手机号绑定、验证码、确认：`wechat`、`phone-bind`、`verification-code`、`action-confirm`。
- 上传/删除附件、提交、重试：基础语义 `upload-record`、`data-delete`、`action-confirm`、`action-refresh`；删除附件的 tone 为 `danger`。
- 带 `open-type` 的原生 button 保持原标签与事件，只在内部增加 `AppIcon`。

## 辅助页（P2）

- 文章、FAQ、邀请、查询页的重试统一 `action-refresh`；FAQ 展开 `nav-chevron-right` 旋转 90°；去咨询 `consult-doctor`；返回 `nav-back`。
- 帮助入口使用 `help-center`，失败/警告分别使用 `status-error`、`status-warning`，不再由 `help` 兼任。

## 底部导航（P1）

- 首页：基础语义均为 `nav-home`；未选中 tone 为 `muted`，选中 tone 为 `primary`。
- 中央咨询：基础语义 `nav-consult`，tone 为 `inverse`。
- 我的：基础语义均为 `nav-profile`；未选中 tone 为 `muted`，选中 tone 为 `primary`。
- 保留中央凸起布局；仅做颜色、透明度与不低于 0.98 的轻微按压缩放，不使用弹跳。低动效模式关闭 transform。

## 必须纠正的语义冲突

1. 问用药与直接咨询：`medication` / `consult-doctor`。
2. 账号安全、退出、解绑：基础语义 `account-security` / `account-logout` / `wechat-unbind`；退出和解绑使用 tone `danger`。
3. 数据导出与删除：基础语义 `data-export` / `data-delete`；删除使用 tone `danger`。
4. 提醒与助手上下文共享：`reminder` / `group-service`。
5. 服务包、服务中心、健康助手：`service-package` / `service-center` / `health-assistant`。
6. 文字图片“查看档案”：真实文本 + `health-record`。
7. 返回字符 `‹`：`nav-back`。
8. `help` 只保留真实帮助语义并改名 `help-center`；错误、重试、警告使用各自语义。
