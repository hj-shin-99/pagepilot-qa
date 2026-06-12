function WorkspaceTabs({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'tech', label: 'Tech QA' },
    { id: 'design', label: 'Design QA' },
    { id: 'visual', label: 'Visual QA' },
    { id: 'history', label: 'History' },
  ]

  return (
    <nav className="workspace-tabs" aria-label="QA 결과 탭">
      {tabs.map((tab) => (
        <button
          aria-pressed={activeTab === tab.id}
          className={activeTab === tab.id ? 'is-active' : ''}
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
