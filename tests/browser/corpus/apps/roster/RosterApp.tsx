import { useState } from 'react'

import { RosterList } from './RosterList.tsx'

interface Member {
  readonly id: string
  readonly name: string
  readonly score: number
}

export function RosterApp(): JSX.Element {
  const [members, setMembers] = useState<Member[]>([
    { id: 'ada', name: 'Ada', score: 1 },
    { id: 'grace', name: 'Grace', score: 2 },
  ])
  const [nextMember, setNextMember] = useState(1)

  return (
    <section className="roster-app">
      <input className="draft" aria-label="Roster draft" />
      <button data-action="reverse" onClick={() => setMembers((current) => current.toReversed())}>
        Reverse
      </button>
      <button
        data-action="add"
        onClick={() => {
          setMembers((current) => [
            ...current,
            {
              id: `new-${nextMember}`,
              name: `New ${nextMember}`,
              score: 0,
            },
          ])
          setNextMember((current) => current + 1)
        }}
      >
        Add member
      </button>
      <RosterList
        count={members.length}
        rows={members.map((member, index) => (
          <li key={member.id} data-member-id={member.id}>
            <span className="member-index">{index}</span>
            <span className="member-name">{member.name}</span>
            <strong className="member-score">{member.score}</strong>
            <button
              data-promote={member.id}
              onClick={() =>
                setMembers((current) =>
                  current.map((candidate) =>
                    candidate.id === member.id
                      ? { ...candidate, score: candidate.score + 1 }
                      : candidate,
                  ),
                )
              }
            >
              Promote
            </button>
          </li>
        ))}
      />
    </section>
  )
}
