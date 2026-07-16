function WorkspaceTabs({ activeTab, disabledTabs = {}, onTabChange }) {
  const tabs = [
    { id: 'visual', label: 'Visual QA' },
    { id: 'tech', label: 'Tech QA' },
    { id: 'history', label: 'History' },
  ]

  return (
    <nav className="workspace-tabs" aria-label="QA 결과 탭">
      {tabs.map((tab) => (
        <button
          aria-pressed={activeTab === tab.id}
          className={activeTab === tab.id ? 'is-active' : ''}
          disabled={Boolean(disabledTabs[tab.id])}
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}

export default WorkspaceTabs
