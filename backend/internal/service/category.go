package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/yurifa/trata/backend/internal/domain"
	"github.com/yurifa/trata/backend/internal/repository"
)

// CategoryService owns household category business rules. householdID (scoping)
// and the acting userID (authorship) are always passed explicitly from the
// transport layer.
type CategoryService struct {
	categories repository.CategoryRepository
}

func NewCategoryService(categories repository.CategoryRepository) *CategoryService {
	return &CategoryService{categories: categories}
}

func (s *CategoryService) Create(
	ctx context.Context,
	scope domain.Scope,
	params domain.CreateCategoryParams,
) (*domain.Category, error) {
	const op = "service.category.Create"
	params.HouseholdID, params.UserID = scope.HouseholdID, scope.ActorID
	c, err := s.categories.CreateCategory(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return c, nil
}

func (s *CategoryService) Update(
	ctx context.Context,
	scope domain.Scope, id uuid.UUID,
	params domain.UpdateCategoryParams,
) (*domain.Category, error) {
	const op = "service.category.Update"
	if params.Name == nil && params.Type == nil && params.Icon == nil && params.Color == nil && params.Archive == nil {
		return nil, ErrNoFieldsToUpdate
	}
	c, err := s.categories.UpdateCategory(ctx, scope, id, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return c, nil
}

func (s *CategoryService) Delete(ctx context.Context, scope domain.Scope, id uuid.UUID, cascade bool) error {
	const op = "service.category.Delete"
	if err := s.categories.DeleteCategory(ctx, scope, id, cascade); err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func (s *CategoryService) Get(ctx context.Context, scope domain.Scope, id uuid.UUID) (*domain.Category, error) {
	const op = "service.category.Get"
	c, err := s.categories.GetCategory(ctx, scope, id)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return c, nil
}

func (s *CategoryService) List(
	ctx context.Context,
	scope domain.Scope,
	params domain.GetCategoriesParams,
) ([]domain.Category, error) {
	const op = "service.category.List"
	c, err := s.categories.GetCategories(ctx, scope, params)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return c, nil
}
