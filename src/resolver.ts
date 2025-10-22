import { Dispatch, SetStateAction, useCallback, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import _ from 'lodash';

import { useStateWithRollback } from './hooks';

export type InputUser = {
  userId: number;
  username: string;
  fullName: string;
};

export type InputProblem = {
  problemId: number;
  name: string;
  points: number;
};

export type InputSubmission = {
  submissionId: number;
  problemId: number;
  userId: number;
  time: number;
  points: number;
};

export type InputData = {
  users: Array<InputUser>;
  problems: Array<InputProblem>;
  submissions: Array<InputSubmission>;
};

export type ImageData = {
  [key: string]: string;
};

export enum ProblemAttemptStatus {
  UNATTEMPTED = 1,
  INCORRECT = 2,
  PARTIAL = 4,
  ACCEPTED = 8,
  PENDING = 16
}

type PointByProblemId = {
  [problemId: number]: number;
};

type StatusByProblemId = {
  [problemId: number]: ProblemAttemptStatus;
};

type ScoreClassByProblemId = {
  [problemId: number]: string;
};

type ProblemById = {
  [problemId: number]: InputProblem;
};

type SubmissionById = {
  [submissionId: number]: InputSubmission;
};

type InternalUser = InputUser & {
  points: PointByProblemId;
  status: StatusByProblemId;
  scoreClass: ScoreClassByProblemId;
  lastAlteringScoreSubmissionIdByProblemId: { [problemId: number]: number };
  lastAlteringScoreSubmissionId: number;
  submissionIdsByProblemId: { [problemId: number]: number[] };
  pendingSubmissionIds: number[];
  penalty: number;
};

type InternalState = {
  shownImage: boolean;
  imageSrc: string | null;
  currentRowIndex: number;
  markedUserId: number;
  markedProblemId: number;
  nextSubmissionId: number;
  users: { [userId: number]: InternalUser };
};

export type UserRow = {
  rank: string;
  userId: number;
  username: string;
  fullName: string;
  total: number;
  penalty: number;
  points: PointByProblemId;
  status: StatusByProblemId;
  scoreClass: ScoreClassByProblemId;
};

function getProblemCodeFromIndex(index: number) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const result = [];
  index += 1;
  while (index > 0) {
    result.push(ALPHABET[(index - 1) % 26]);
    index = (index - 1) / 26;
  }
  return result.reverse().join('');
}

function getScoreClass(userPoints: number, problemPoints: number) {
  if (userPoints === problemPoints) {
    return 'score_100';
  } else if (userPoints === 0) {
    return 'score_0';
  } else {
    return 'score_40_50';
  }

  // const ratio = userPoints / problemPoints;
  // if (ratio >= 0.9) {
  //   return 'score_90_100';
  // } else if (ratio >= 0.8) {
  //   return 'score_80_90';
  // } else if (ratio >= 0.7) {
  //   return 'score_70_80';
  // } else if (ratio >= 0.6) {
  //   return 'score_60_70';
  // } else if (ratio >= 0.5) {
  //   return 'score_50_60';
  // } else if (ratio >= 0.4) {
  //   return 'score_40_50';
  // } else if (ratio >= 0.3) {
  //   return 'score_30_40';
  // } else if (ratio >= 0.2) {
  //   return 'score_20_30';
  // } else if (ratio >= 0.1) {
  //   return 'score_10_20';
  // } else {
  //   return 'score_0_10';
  // }
}

function calculatePenalty(user: InternalUser, submissionById: SubmissionById) {
  if (user.lastAlteringScoreSubmissionId === -1) {
    return 0;
  }

  let incorrect = 0;
  for (const [problemId, last] of Object.entries(
    user.lastAlteringScoreSubmissionIdByProblemId
  )) {
    if (submissionById[last].points === 0) {
      continue;
    }

    incorrect += user.submissionIdsByProblemId[problemId as any].filter(
      (submissionId) => submissionId < last
    ).length;
  }

  return (
    submissionById[user.lastAlteringScoreSubmissionId].time + 300 * incorrect // '1200' for ICPC, '300' for VNOJ
  );
}

function resolvePendingSubmission({
  submissionId,
  submissionById,
  pointByProblemId,
  state,
  setState
}: {
  submissionId: number;
  submissionById: SubmissionById;
  pointByProblemId: PointByProblemId;
  state: InternalState;
  setState: Dispatch<SetStateAction<InternalState>>;
}) {
  state = _.cloneDeep(state);

  const submission = submissionById[submissionId];
  const user = state.users[submission.userId];
  const problemId = submission.problemId;

  if (submission.points > user.points[problemId]) {
    user.points[problemId] = submission.points;
    user.lastAlteringScoreSubmissionIdByProblemId[problemId] = submissionId;
    user.lastAlteringScoreSubmissionId = Math.max(
      user.lastAlteringScoreSubmissionId,
      submissionId
    );
  } else if (submission.points === 0 && user.points[problemId] === 0) {
    user.lastAlteringScoreSubmissionIdByProblemId[problemId] = submissionId;
  }

  if (user.points[problemId] === 0) {
    user.status[problemId] = ProblemAttemptStatus.INCORRECT;
  } else if (user.points[problemId] < pointByProblemId[problemId]) {
    user.status[problemId] = ProblemAttemptStatus.PARTIAL;
  } else {
    user.status[problemId] = ProblemAttemptStatus.ACCEPTED;
  }

  user.scoreClass[problemId] = getScoreClass(
    user.points[problemId],
    pointByProblemId[problemId]
  );

  user.pendingSubmissionIds = _.without(
    user.pendingSubmissionIds,
    submissionId
  );

  user.penalty += calculatePenalty(user, submissionById); // '=' for VNOJ, '+=' for ICPC

  setState({ ...state, markedProblemId: -1, nextSubmissionId: -1 });
}

function rankUsers(
  state: InternalState,
  unofficialContestants: string[]
): UserRow[] {
  const rows = _.orderBy(
    _.values(state.users).map((user) => {
      const total = _.sum(_.values(user.points));
      return { ...user, total, rank: '' };
    }),
    ['total', 'penalty'],
    ['desc', 'asc']
  );

  let [lastTotal, lastPenalty, rank, cnt] = [-1, -1, 0, 0];
  for (let i = 0; i < rows.length; i++) {
    if (unofficialContestants.includes(rows[i].username)) {
      continue;
    }
    cnt += 1;
    if (rows[i].total !== lastTotal || rows[i].penalty !== lastPenalty) {
      rank = cnt;
      lastTotal = rows[i].total;
      lastPenalty = rows[i].penalty;
    }
    rows[i].rank = rank.toString();
  }

  return rows;
}

export function useResolver({
  inputData,
  imageData,
  unofficialContestants,
  frozenTime
}: {
  inputData: InputData;
  imageData: ImageData;
  unofficialContestants: string[];
  frozenTime: number;
}): {
  columns: ColumnDef<UserRow>[];
  data: UserRow[];
  currentRowIndex: number;
  markedUserId: number;
  markedProblemId: number;
  imageSrc: string | null;
  step: (nextSubmissionOrderToResolve?: number) => boolean;
  rollback: () => void;
} {
  const userIds = useMemo<number[]>(
    () => inputData.users.map((user) => user.userId),
    [inputData.users]
  );

  const filteredSubmissions = useMemo<InputSubmission[]>(
    () =>
      inputData.submissions.filter((submission) =>
        userIds.includes(submission.userId)
      ),
    [inputData.submissions, userIds]
  );

  const problemById = useMemo<ProblemById>(
    () => _.keyBy(inputData.problems, 'problemId'),
    [inputData.problems]
  );

  const submissionById = useMemo<SubmissionById>(
    () => _.keyBy(filteredSubmissions, 'submissionId'),
    [filteredSubmissions]
  );

  const pointByProblemId = useMemo<PointByProblemId>(
    () =>
      _.mapValues(
        _.keyBy(inputData.problems, 'problemId'),
        (problem) => problem.points
      ),
    [inputData.problems]
  );

  const columns = useMemo(() => {
    const columns: ColumnDef<UserRow>[] = [];

    columns.push({
      id: 'rank',
      header: 'Rank',
      accessorKey: 'rank'
    });

    columns.push({
      id: 'name',
      header: 'Name',
      accessorFn: (row: UserRow) => ({
        fullName: row.fullName,
        username: row.username
      })
    });

    inputData.problems.forEach((problem, index) => {
      columns.push({
        id: `problem_${problem.problemId}`,
        header: getProblemCodeFromIndex(index),
        accessorFn: (row: UserRow) => row.points[problem.problemId],
        meta: {
          isProblem: true,
          problemId: problem.problemId,
          points: problem.points
        }
      });
    });

    columns.push({
      id: 'total',
      header: 'Score',
      accessorKey: 'total'
    });

    columns.push({
      id: 'penalty',
      header: 'Time',
      accessorFn: (row) =>
        new Date(row.penalty * 1000).toISOString().substring(11, 19)
    });

    return columns;
  }, [inputData.problems]);

  const [state, setState, rollback] = useStateWithRollback(() => {
    function processSubmissions(submissions: InputSubmission[]): InternalState {
      const state: InternalState = {
        shownImage: false,
        imageSrc: null,
        currentRowIndex: inputData.users.length - 1,
        markedUserId: -1,
        markedProblemId: -1,
        nextSubmissionId: -1,
        users: _.keyBy(
          inputData.users.map((user) => ({
            ...user,
            points: _.mapValues(pointByProblemId, () => 0),
            status: _.mapValues(
              pointByProblemId,
              () => ProblemAttemptStatus.UNATTEMPTED
            ),
            scoreClass: _.mapValues(pointByProblemId, () => 'a'),
            lastAlteringScoreSubmissionIdByProblemId: {},
            lastAlteringScoreSubmissionId: -1,
            submissionIdsByProblemId: _.mapValues(pointByProblemId, () => []),
            pendingSubmissionIds: [],
            penalty: 0
          })),
          'userId'
        )
      };

      submissions = _.sortBy(submissions, 'submissionId');

      for (const submission of submissions) {
        const user = state.users[submission.userId];
        const problemId = submission.problemId;
        const submissionId = submission.submissionId;

        if (submission.points > user.points[problemId]) {
          user.points[problemId] = submission.points;
          user.lastAlteringScoreSubmissionIdByProblemId[problemId] =
            submissionId;
          user.lastAlteringScoreSubmissionId = submissionId;
        } else if (submission.points === 0 && user.points[problemId] === 0) {
          user.lastAlteringScoreSubmissionIdByProblemId[problemId] =
            submissionId;
        }

        user.submissionIdsByProblemId[problemId].push(submissionId);
      }

      for (const userId in state.users) {
        const user = state.users[userId];
        for (const problemId in problemById) {
          if (user.submissionIdsByProblemId[problemId].length === 0) {
            continue;
          }

          if (user.points[problemId] === 0) {
            user.status[problemId] = ProblemAttemptStatus.INCORRECT;
          } else if (user.points[problemId] < pointByProblemId[problemId]) {
            user.status[problemId] = ProblemAttemptStatus.PARTIAL;
          } else {
            user.status[problemId] = ProblemAttemptStatus.ACCEPTED;
          }

          user.scoreClass[problemId] = getScoreClass(
            user.points[problemId],
            pointByProblemId[problemId]
          );
        }

        user.penalty = calculatePenalty(user, submissionById);
      }

      return state;
    }

    const publicState = processSubmissions(
      filteredSubmissions.filter((submission) => submission.time < frozenTime)
    );
    const privateState = processSubmissions(filteredSubmissions);

    for (const userId in publicState.users) {
      const publicUser = publicState.users[userId];
      const privateUser = privateState.users[userId];
      publicUser.submissionIdsByProblemId =
        privateUser.submissionIdsByProblemId;

      for (const problemId in problemById) {
        if (
          publicUser.lastAlteringScoreSubmissionIdByProblemId[problemId] !==
          privateUser.lastAlteringScoreSubmissionIdByProblemId[problemId]
        ) {
          publicUser.pendingSubmissionIds.push(
            privateUser.lastAlteringScoreSubmissionIdByProblemId[problemId]
          );
          publicUser.status[problemId] |= ProblemAttemptStatus.PENDING;
        }
      }

      publicUser.pendingSubmissionIds = _.sortBy(
        publicUser.pendingSubmissionIds,
        (id) => submissionById[id].problemId
      );
    }

    return publicState;
  });

  const data = useMemo(
    () => rankUsers(state, unofficialContestants),
    [state, unofficialContestants]
  );

  const step = useCallback(
    (nextSubmissionOrderToResolve?: number) => {
      const {
        shownImage,
        imageSrc,
        currentRowIndex,
        markedUserId,
        markedProblemId
      } = state;
      if (currentRowIndex === -1) {
        return false;
      }

      if (markedUserId !== data[currentRowIndex]!.userId) {
        setState({
          ...state,
          currentRowIndex,
          markedUserId: data[currentRowIndex]!.userId,
          markedProblemId: -1,
          nextSubmissionId: -1
        });
        return true;
      }

      if (
        !state.users[data[currentRowIndex].userId]!.pendingSubmissionIds!.length
      ) {
        if (
          data[currentRowIndex].rank in imageData &&
          !shownImage &&
          imageSrc === null
        ) {
          setState({
            ...state,
            shownImage: true,
            imageSrc: imageData[data[currentRowIndex].rank]
          });
          return true;
        }

        if (shownImage && imageSrc !== null) {
          setState({
            ...state,
            imageSrc: null
          });
          return true;
        }

        if (currentRowIndex === 0) {
          setState({
            ...state,
            shownImage: false,
            imageSrc: null,
            currentRowIndex: -1,
            markedUserId: -1,
            markedProblemId: -1,
            nextSubmissionId: -1
          });
          return false;
        }

        const markedUserId = data[currentRowIndex - 1]!.userId;
        setState({
          ...state,
          shownImage: false,
          imageSrc: null,
          currentRowIndex: currentRowIndex - 1,
          markedUserId,
          markedProblemId: -1,
          nextSubmissionId: -1
        });

        return true;
      }

      if (markedProblemId === -1) {
        let nextSubmissionId;
        if (nextSubmissionOrderToResolve !== undefined) {
          if (
            nextSubmissionOrderToResolve < 0 ||
            nextSubmissionOrderToResolve >=
              state.users[markedUserId].pendingSubmissionIds.length
          ) {
            console.log('Invalid nextSubmissionOrderToResolve');
            return true;
          }

          nextSubmissionId =
            state.users[markedUserId].pendingSubmissionIds[
              nextSubmissionOrderToResolve
            ];
        }

        if (nextSubmissionId === undefined) {
          nextSubmissionId =
            _.minBy(
              state.users[markedUserId].pendingSubmissionIds,
              (id) => submissionById[id].problemId
            ) ?? -1;
        }

        setState({
          ...state,
          currentRowIndex,
          markedUserId,
          markedProblemId: submissionById[nextSubmissionId]?.problemId ?? -1,
          nextSubmissionId
        });
        return true;
      }

      resolvePendingSubmission({
        submissionId: state.nextSubmissionId,
        submissionById,
        pointByProblemId,
        state,
        setState
      });

      return true;
    },
    [submissionById, pointByProblemId, state, data, imageData, setState]
  );

  return {
    columns,
    data,
    currentRowIndex: state.currentRowIndex,
    markedUserId: state.markedUserId,
    markedProblemId: state.markedProblemId,
    imageSrc: state.imageSrc,
    step,
    rollback
  };
}
