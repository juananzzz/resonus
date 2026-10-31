Pod::Spec.new do |s|
  s.name = 'signature-ink'
  s.version = '0.0.1'
  s.summary = 'Decoded artist signature alpha validation'
  s.description = 'Checks transparent artist title masks without lossy alpha hashes.'
  s.authors = 'Resonus'
  s.homepage = 'https://github.com/juananzzz/resonus'
  s.platforms = { :ios => '15.1' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
