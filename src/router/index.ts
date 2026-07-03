import { createRouter, createWebHistory } from "vue-router";
import { hasApiKey } from "@/lib/api";
import OnboardingView from "@/views/OnboardingView.vue";
import MainLayout from "@/layouts/MainLayout.vue";
import CoursesView from "@/views/CoursesView.vue";
import StudyView from "@/views/StudyView.vue";
import SettingsView from "@/views/SettingsView.vue";
import PlaygroundView from "@/views/PlaygroundView.vue";
import QuizView from "@/views/QuizView.vue";
import ReviewView from "@/views/ReviewView.vue";
import ReviewStatsView from "@/views/ReviewStatsView.vue";
import WrongAnswersView from "@/views/WrongAnswersView.vue";
import AllReviewsView from "@/views/AllReviewsView.vue";
import AllWrongAnswersView from "@/views/AllWrongAnswersView.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/onboarding", name: "onboarding", component: OnboardingView },
    {
      path: "/app",
      component: MainLayout,
      children: [
        { path: "", redirect: "/app/courses" },
        { path: "courses", name: "courses", component: CoursesView },
        { path: "study/:id", name: "study", component: StudyView },
        { path: "quiz/:courseId/:stepId", name: "quiz", component: QuizView },
        { path: "reviews", name: "reviews", component: AllReviewsView },
        { path: "review/:id", name: "review", component: ReviewView },
        { path: "review/:id/stats", name: "review-stats", component: ReviewStatsView },
        { path: "wrong-answers", name: "wrong-answers-all", component: AllWrongAnswersView },
        { path: "wrong-answers/:id", name: "wrong-answers", component: WrongAnswersView },
        { path: "playground", name: "playground", component: PlaygroundView },
        { path: "settings", name: "settings", component: SettingsView },
      ],
    },
    { path: "/", redirect: "/app" },
  ],
});

// 首启守卫:没配置 key 强制去引导页;已配置则不许再回引导页
router.beforeEach(async (to) => {
  const configured = await hasApiKey();
  if (!configured && to.name !== "onboarding") return { name: "onboarding" };
  if (configured && to.name === "onboarding") return { path: "/app" };
  return true;
});

export default router;
