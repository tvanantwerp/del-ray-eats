import images from '../../data/images.json';

const sources = images.formats.flatMap(format => {
  return images.resolutions.map(res => {
    return { format, width: res[0], height: res[1] };
  });
});

interface SourceProps {
  format: string;
  slug: string;
  width: number;
  height: number;
}

const Source = ({ format, slug, width, height }: SourceProps) => (
  <source
    type={`image/${format === 'jpg' ? 'jpeg' : format}`}
    srcSet={`/images/${slug}-${width}-${height}.${format} ${width}w`}
    media={`(min-width: ${width - 400}px)`}
  />
);

interface ImageProps {
  alt: string;
  slug: string;
}

export const Image = ({ alt, slug }: ImageProps) => (
  <picture>
    {sources.map(source => (
      <Source
        slug={slug}
        format={source.format}
        width={source.width!}
        height={source.height!}
      />
    ))}
    <img
      className="object-cover rounded-t-lg"
      src={`/images/${slug}-400-300.jpg`}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  </picture>
);
