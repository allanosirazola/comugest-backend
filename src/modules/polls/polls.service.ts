import { type VoteOption } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import type { CreatePollInput, CastVoteInput } from './polls.schemas';

type UserRole = 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO';

export async function listPolls(meetingId: string, userId: string) {
  const polls = await prisma.poll.findMany({
    where: { meetingId },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { votes: true } },
      votes: {
        select: { option: true, userId: true, isTelematic: true },
      },
    },
  });

  return polls.map((poll) => {
    const results: Record<VoteOption, number> & { telematic: number; inPerson: number } = {
      FAVOR: 0,
      CONTRA: 0,
      ABSTENCION: 0,
      telematic: 0,
      inPerson: 0,
    };
    let myVote: VoteOption | null = null;

    for (const vote of poll.votes) {
      results[vote.option] = (results[vote.option] ?? 0) + 1;
      if (vote.isTelematic) {
        results.telematic += 1;
      } else {
        results.inPerson += 1;
      }
      if (vote.userId === userId) {
        myVote = vote.option;
      }
    }

    const { votes: _votes, ...pollWithoutVotes } = poll;
    void _votes; // suppress unused variable warning

    return {
      ...pollWithoutVotes,
      results,
      myVote,
    };
  });
}

export async function createPoll(
  actorId: string,
  actorRole: UserRole,
  meetingId: string,
  input: CreatePollInput
) {
  if (actorRole !== 'ADMIN_FINCAS' && actorRole !== 'SUPPORT') {
    throw new ForbiddenError('Solo los administradores pueden crear votaciones');
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) throw new NotFoundError('Reunión no encontrada');

  const poll = await prisma.poll.create({
    data: {
      meetingId,
      question: input.question,
      description: input.description ?? null,
      votingDeadline: input.votingDeadline ?? null,
      requiresAttendance: input.requiresAttendance ?? false,
      createdById: actorId,
    },
    include: {
      _count: { select: { votes: true } },
    },
  });

  void audit({
    action: 'POLL_CREATED',
    actorId,
    targetType: 'Poll',
    targetId: poll.id,
    communityId: meeting.communityId,
    meta: { question: poll.question, meetingId },
  });

  return poll;
}

export async function closePoll(actorId: string, actorRole: UserRole, pollId: string) {
  if (actorRole !== 'ADMIN_FINCAS' && actorRole !== 'SUPPORT') {
    throw new ForbiddenError('Solo los administradores pueden cerrar votaciones');
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { meeting: true },
  });
  if (!poll) throw new NotFoundError('Votación no encontrada');

  if (poll.status === 'CLOSED') {
    throw new ValidationError('La votación ya está cerrada');
  }

  // Compute quorumReached: votes cast vs total attendees of the meeting
  let quorumReached: boolean | null = null;
  const totalAttendees = await prisma.meetingAttendee.count({
    where: { meetingId: poll.meetingId },
  });

  if (totalAttendees > 0) {
    const votesCast = await prisma.vote.count({ where: { pollId } });
    quorumReached = votesCast / totalAttendees > 0.5;
  }

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: { status: 'CLOSED', quorumReached },
  });

  void audit({
    action: 'POLL_CLOSED',
    actorId,
    targetType: 'Poll',
    targetId: pollId,
    communityId: poll.meeting.communityId,
    meta: { question: poll.question, meetingId: poll.meetingId, quorumReached },
  });

  return updated;
}

export async function castVote(userId: string, pollId: string, input: CastVoteInput) {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { meeting: true },
  });
  if (!poll) throw new NotFoundError('Votación no encontrada');

  if (poll.status === 'CLOSED') {
    throw new ValidationError('No se puede votar en una votación cerrada');
  }

  // Check voting deadline
  if (poll.votingDeadline !== null && poll.votingDeadline < new Date()) {
    throw new ValidationError('Voting period has ended');
  }

  // Check requiresAttendance: user must be a MeetingAttendee
  if (poll.requiresAttendance) {
    const attendee = await prisma.meetingAttendee.findUnique({
      where: { meetingId_userId: { meetingId: poll.meetingId, userId } },
    });
    if (!attendee) {
      throw new ForbiddenError('You must be a meeting attendee to vote');
    }
  }

  // Determine isTelematic: false if user has MeetingAttendee record with status PRESENT
  // Note: AttendanceStatus enum has PENDING | CONFIRMED | DECLINED | DELEGATED — no PRESENT
  // We treat CONFIRMED as in-person presence (physically attending)
  const attendeeRecord = await prisma.meetingAttendee.findUnique({
    where: { meetingId_userId: { meetingId: poll.meetingId, userId } },
  });
  // CONFIRMED = attending in person, not telematic
  const isTelematic = !(attendeeRecord?.status === 'CONFIRMED');

  const vote = await prisma.vote.upsert({
    where: { pollId_userId: { pollId, userId } },
    create: {
      pollId,
      userId,
      option: input.option,
      isTelematic,
    },
    update: {
      option: input.option,
      isTelematic,
    },
  });

  void audit({
    action: 'VOTE_CAST',
    actorId: userId,
    targetType: 'Vote',
    targetId: vote.id,
    communityId: poll.meeting.communityId,
    meta: { pollId, option: input.option, isTelematic },
  });

  return vote;
}
