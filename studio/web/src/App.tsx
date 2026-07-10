import { useState } from "react";
import IdeaPanel from "./components/IdeaPanel";
import ResearchPanel from "./components/ResearchPanel";
import Tabbar from "./components/Tabbar";
import type { Tab } from "./types";

const MASTHEAD_LEAD =
  "依頼を入力して実行すると、裏で Claude がリサーチ／アイデア生成を行い、結果はそのまま Web の RM に反映されます。カードをクリックすると RM の詳細ページが開きます。";

const FOOT_TEXT =
  "ResearchMan Studio — ローカル(Mac) / 2タブ・入力→Researching→結果 / 結果はWeb RMへ自動反映・カードは詳細ページへのリンク / モックアップ";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("research");

  return (
    <div className="page">
      <div className="wrap">
        <header className="masthead">
          <p className="kicker">Design Mockup</p>
          <h1>ResearchMan Studio</h1>
          <p>{MASTHEAD_LEAD}</p>
        </header>

        <Tabbar activeTab={activeTab} onChange={setActiveTab} />

        <div className="win">
          <section
            id="panel-research"
            className={`panel${activeTab === "research" ? " on" : ""}`}
            data-panel="research"
            role="tabpanel"
            aria-labelledby="tab-research"
          >
            <ResearchPanel />
          </section>

          <section
            id="panel-idea"
            className={`panel${activeTab === "idea" ? " on" : ""}`}
            data-panel="idea"
            role="tabpanel"
            aria-labelledby="tab-idea"
          >
            <IdeaPanel />
          </section>
        </div>

        <p className="foot">{FOOT_TEXT}</p>
      </div>
    </div>
  );
}
