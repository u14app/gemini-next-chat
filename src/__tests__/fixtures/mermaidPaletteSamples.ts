export const mermaidPaletteSamples = {
  gitGraph: `gitGraph
    commit id: "开始" tag: "v1"
    branch feature
    checkout feature
    commit id: "功能"
    checkout main
    commit id: "维护"
    merge feature
    commit id: "发布" tag: "v2"`,
  timeline: `timeline
    title 项目时间线
    section 规划
      2024 : 需求调研 : 技术选型
    section 开发
      2025 : 原型实现 : 功能开发
    section 发布
      2026 : 测试验收 : 正式发布`,
  kanban: `kanban
    todo[待处理]
      task1[调研需求]
      task2[设计方案]
    doing[进行中]
      task3[实现功能]
    done[已完成]
      task4[搭建环境]`,
  radar: `radar-beta
    title 能力对比
    axis a["性能"], b["可靠性"], c["易用性"]
    curve first["方案一"]{80,90,70}
    curve second["方案二"]{65,75,95}
    max 100`,
  treemap: `treemap-beta
    "产品"
      "聊天": 40
      "研究": 30
    "平台"
      "存储": 20
      "监控": 10`,
};
