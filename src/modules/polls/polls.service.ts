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
        select: { option: true, userId: true },
      },
    },
  });

  return polls.map((poll) => {
    const results: Record<VoteOption, number> = { FAVOR: 0, CONTRA: 0, ABSTENCION: 0 };
    let myVote: VoteOption | null = null;

    for (const vote of poll.votes) {
      results[vote.option] = (results[vote.option] ?? 0) + 1;
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

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: { status: 'CLOSED' },
  });

  void audit({
    action: 'POLL_CLOSED',
    actorId,
    targetType: 'Poll',
    targetId: pollId,
    communityId: poll.meeting.communityId,
    meta: { question: poll.question, meetingId: poll.meetingId },
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

  const vote = await prisma.vote.upsert({
    where: { pollId_userId: { pollId, userId } },
    create: {
      pollId,
      userId,
      option: input.option,
    },
    update: {
      option: input.option,
    },
  });

  void audit({
    action: 'VOTE_CAST',
    actorId: userId,
    targetType: 'Vote',
    targetId: vote.id,
    communityId: poll.meeting.communityId,
    meta: { pollId, option: input.option },
  });

  return vote;
}
